import type { Env, ExperimentRow, PostRow, ThreadsAuthRow } from '../types';
import { decryptSecret, encryptSecret } from './crypto';
import { generateHookDrafts } from './llm';
import { defaultThreadsPublisher, type ThreadsPublisher } from './threads';

const MAX_PUBLISH_BATCH = 3;
const MAX_RETRY_COUNT = 2;
const RETRY_DELAY_MS = 5 * 60_000;

export async function getActiveAccessToken(env: Env): Promise<{
  auth: ThreadsAuthRow;
  accessToken: string;
} | null> {
  const auth = await env.DB.prepare('SELECT * FROM threads_auth WHERE id = 1').first<ThreadsAuthRow>();
  if (!auth) return null;
  const accessToken = await decryptSecret(auth.access_token_enc, env.TOKEN_ENCRYPTION_KEY);
  return { auth, accessToken };
}

export async function publishSinglePost(
  env: Env,
  postId: string,
  publisher: ThreadsPublisher = defaultThreadsPublisher
): Promise<{ status: 'published' | 'failed' | 'scheduled'; threadsPostId?: string; error?: string }> {
  const now = Date.now();
  const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first<PostRow>();
  if (!post) {
    throw new Error('Post not found');
  }

  const creds = await getActiveAccessToken(env);
  if (!creds) {
    throw new Error('Threads account is not connected');
  }

  // Atomic lock to prevent concurrent cron + manual publish races
  const lock = await env.DB.prepare(
    "UPDATE posts SET status = 'publishing', updated_at = ? WHERE id = ? AND status IN ('draft', 'scheduled', 'failed')"
  )
    .bind(now, post.id)
    .run();

  if ((lock.meta?.changes ?? 0) === 0) {
    return { status: 'publishing' as 'scheduled' };
  }

  try {
    const parts = JSON.parse(post.parts_json) as string[];
    const result = await publisher.publishThreadParts(creds.accessToken, parts);
    const doneAt = Date.now();

    await env.DB.prepare(
      "UPDATE posts SET status = 'published', threads_post_id = ?, published_at = ?, last_error = NULL, updated_at = ? WHERE id = ?"
    )
      .bind(result.rootPostId, doneAt, doneAt, post.id)
      .run();

    return { status: 'published', threadsPostId: result.rootPostId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown publish error';
    const nextRetry = post.retry_count + 1;
    const failedAt = Date.now();

    if (post.retry_count < MAX_RETRY_COUNT && post.status === 'scheduled') {
      await env.DB.prepare(
        "UPDATE posts SET status = 'scheduled', scheduled_at = ?, retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?"
      )
        .bind(failedAt + RETRY_DELAY_MS, nextRetry, message.slice(0, 400), failedAt, post.id)
        .run();
      return { status: 'scheduled', error: message };
    }

    await env.DB.prepare(
      "UPDATE posts SET status = 'failed', retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?"
    )
      .bind(nextRetry, message.slice(0, 400), failedAt, post.id)
      .run();

    return { status: 'failed', error: message };
  }
}

export async function runPublishDuePosts(
  env: Env,
  publisher: ThreadsPublisher = defaultThreadsPublisher
): Promise<{ processed: number; published: number; failed: number }> {
  const now = Date.now();
  const due = await env.DB.prepare(
    "SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT ?"
  )
    .bind(now, MAX_PUBLISH_BATCH)
    .all<{ id: string }>();

  let published = 0;
  let failed = 0;

  for (const row of due.results) {
    try {
      const outcome = await publishSinglePost(env, row.id, publisher);
      if (outcome.status === 'published') published += 1;
      if (outcome.status === 'failed') failed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    processed: due.results.length,
    published,
    failed,
  };
}

export async function runSyncInsights(
  env: Env,
  publisher: ThreadsPublisher = defaultThreadsPublisher
): Promise<{ synced: number }> {
  const creds = await getActiveAccessToken(env);
  if (!creds) return { synced: 0 };

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const posts = await env.DB.prepare(
    "SELECT id, threads_post_id FROM posts WHERE status = 'published' AND threads_post_id IS NOT NULL AND published_at >= ? ORDER BY published_at DESC LIMIT 15"
  )
    .bind(sevenDaysAgo)
    .all<{ id: string; threads_post_id: string }>();

  let synced = 0;
  const now = Date.now();

  for (const post of posts.results) {
    try {
      const insights = await publisher.fetchThreadInsights(creds.accessToken, post.threads_post_id);
      await env.DB.prepare(
        'INSERT INTO post_metrics (post_id, views, likes, replies, reposts, quotes, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(
          post.id,
          insights.views,
          insights.likes,
          insights.replies,
          insights.reposts,
          insights.quotes,
          now
        )
        .run();
      synced += 1;
    } catch {
      // Keep syncing remaining posts even if one insights call fails
    }
  }

  return { synced };
}

export async function runDailyMaintenance(
  env: Env,
  publisher: ThreadsPublisher = defaultThreadsPublisher
): Promise<{ refreshedToken: boolean; generatedDrafts: number }> {
  let refreshedToken = false;
  let generatedDrafts = 0;

  const creds = await getActiveAccessToken(env);
  if (creds) {
    const twentyFiveDaysMs = 25 * 24 * 60 * 60 * 1000;
    if (creds.auth.expires_at - Date.now() < twentyFiveDaysMs) {
      try {
        const refreshed = await publisher.refreshLongLivedToken(creds.accessToken);
        const enc = await encryptSecret(refreshed.accessToken, env.TOKEN_ENCRYPTION_KEY);
        const now = Date.now();
        await env.DB.prepare(
          'UPDATE threads_auth SET access_token_enc = ?, expires_at = ?, updated_at = ? WHERE id = 1'
        )
          .bind(enc, now + refreshed.expiresInSeconds * 1000, now)
          .run();
        refreshedToken = true;
      } catch {
        // Token refresh failure leaves existing token intact until manual reconnect
      }
    }
  }

  if (env.LLM_API_KEY) {
    const autoExps = await env.DB.prepare(
      'SELECT * FROM experiments WHERE active = 1 AND auto_generate = 1 ORDER BY created_at DESC LIMIT 3'
    ).all<ExperimentRow>();

    const hooks: Array<'pain_point' | 'hot_take' | 'question' | 'mini_story'> = [
      'pain_point',
      'hot_take',
      'question',
      'mini_story',
    ];
    const dayIdx = new Date().getUTCDate() % hooks.length;

    for (const exp of autoExps.results) {
      try {
        const drafts = await generateHookDrafts(env, {
          experiment: exp,
          hookType: hooks[dayIdx],
          count: 1,
          isChain: false,
        });
        const now = Date.now();
        for (const draft of drafts) {
          await env.DB.prepare(
            "INSERT INTO posts (id, experiment_id, hook_type, parts_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)"
          )
            .bind(crypto.randomUUID(), exp.id, draft.hook_type, JSON.stringify(draft.parts), now, now)
            .run();
          generatedDrafts += 1;
        }
      } catch {
        // Skip failed experiment generation without aborting maintenance
      }
    }
  }

  return { refreshedToken, generatedDrafts };
}
