import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env, ExperimentRow, HookType, PostRow, ThreadsAuthRow } from './types';
import {
  encryptSecret,
  signSession,
  timingSafeEqual,
  verifySession,
} from './lib/crypto';
import {
  getActiveAccessToken,
  publishSinglePost,
  runDailyMaintenance,
  runPublishDuePosts,
  runSyncInsights,
} from './lib/jobs';
import { generateHookDrafts } from './lib/llm';
import {
  buildThreadsAuthorizeUrl,
  deleteThreadsPost,
  exchangeCodeForToken,
  fetchUserThreads,
} from './lib/threads';

const SESSION_COOKIE = 'tl_session';
const OAUTH_STATE_COOKIE = 'tl_oauth_state';

const app = new Hono<{ Bindings: Env }>();

function isSecureRequest(url: string): boolean {
  return url.startsWith('https://');
}

app.onError((err, c) => {
  console.error('Unhandled API error:', err.message);
  return c.json({ error: 'Internal server error' }, 500);
});

app.get('/api/health', (c) => {
  return c.json({ ok: true, service: 'threads-lab' });
});

// --- Auth ---
app.post('/api/auth/login', async (c) => {
  if (!c.env.ADMIN_PASSWORD || !c.env.TOKEN_ENCRYPTION_KEY) {
    return c.json({ error: 'Server auth secrets are not configured' }, 500);
  }
  const body = await c.req.json<{ password?: string }>().catch(() => ({ password: '' }));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || !timingSafeEqual(password, c.env.ADMIN_PASSWORD)) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  const token = await signSession({ role: 'admin' }, c.env.TOKEN_ENCRYPTION_KEY);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(c.req.url),
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({ authenticated: true });
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/auth/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !c.env.TOKEN_ENCRYPTION_KEY) {
    return c.json({ authenticated: false });
  }
  const session = await verifySession(token, c.env.TOKEN_ENCRYPTION_KEY);
  return c.json({ authenticated: Boolean(session) });
});

// OAuth callback uses signed state cookie instead of session middleware
app.get('/api/threads/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const expectedState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' });

  if (!code || !state || !expectedState) {
    return c.redirect('/?threads_error=missing_oauth_state');
  }

  const verifiedState = await verifySession<{ nonce: string }>(
    expectedState,
    c.env.TOKEN_ENCRYPTION_KEY
  );
  if (!verifiedState || !timingSafeEqual(verifiedState.nonce, state)) {
    return c.redirect('/?threads_error=invalid_oauth_state');
  }

  try {
    const tokenInfo = await exchangeCodeForToken(c.env, code);
    const enc = await encryptSecret(tokenInfo.accessToken, c.env.TOKEN_ENCRYPTION_KEY);
    const now = Date.now();
    const expiresAt = now + tokenInfo.expiresInSeconds * 1000;

    await c.env.DB.prepare(
      `INSERT INTO threads_auth (id, threads_user_id, username, access_token_enc, expires_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         threads_user_id = excluded.threads_user_id,
         username = excluded.username,
         access_token_enc = excluded.access_token_enc,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    )
      .bind(tokenInfo.threadsUserId, tokenInfo.username, enc, expiresAt, now)
      .run();

    return c.redirect('/?threads_connected=1');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth_failed';
    return c.redirect(`/?threads_error=${encodeURIComponent(msg.slice(0, 120))}`);
  }
});

// Protect all other /api/* routes
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    path === '/api/health' ||
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path === '/api/auth/me' ||
    path === '/api/threads/callback'
  ) {
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !c.env.TOKEN_ENCRYPTION_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const session = await verifySession(token, c.env.TOKEN_ENCRYPTION_KEY);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

// --- Threads OAuth & Status ---
app.get('/api/threads/status', async (c) => {
  const auth = await c.env.DB.prepare(
    'SELECT threads_user_id, username, expires_at, updated_at FROM threads_auth WHERE id = 1'
  ).first<Omit<ThreadsAuthRow, 'id' | 'access_token_enc'>>();

  const oauthConfigured = Boolean(
    c.env.THREADS_APP_ID && c.env.THREADS_APP_SECRET && c.env.THREADS_REDIRECT_URI
  );
  const llmConfigured = Boolean(c.env.LLM_API_KEY);

  return c.json({
    connected: Boolean(auth),
    oauthConfigured,
    llmConfigured,
    llmModel: c.env.LLM_MODEL || 'gpt-4o-mini',
    account: auth
      ? {
          threadsUserId: auth.threads_user_id,
          username: auth.username,
          expiresAt: auth.expires_at,
          updatedAt: auth.updated_at,
        }
      : null,
  });
});

app.get('/api/threads/connect', async (c) => {
  const nonce = crypto.randomUUID();
  const signedState = await signSession({ nonce }, c.env.TOKEN_ENCRYPTION_KEY, 600);
  setCookie(c, OAUTH_STATE_COOKIE, signedState, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(c.req.url),
    path: '/',
    maxAge: 600,
  });

  try {
    const url = buildThreadsAuthorizeUrl(c.env, nonce);
    return c.json({ url });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'OAuth config missing' }, 400);
  }
});

app.delete('/api/threads/disconnect', async (c) => {
  await c.env.DB.prepare('DELETE FROM threads_auth WHERE id = 1').run();
  return c.json({ ok: true });
});

app.get('/api/threads/posts', async (c) => {
  const creds = await getActiveAccessToken(c.env);
  if (!creds) {
    return c.json({ error: 'Threads account is not connected' }, 400);
  }
  try {
    const posts = await fetchUserThreads(creds.accessToken, 25);
    return c.json({ posts });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to fetch Threads posts' }, 400);
  }
});

app.delete('/api/threads/posts/:threadsPostId', async (c) => {
  const threadsPostId = c.req.param('threadsPostId');
  const creds = await getActiveAccessToken(c.env);
  if (!creds) {
    return c.json({ error: 'Threads account is not connected' }, 400);
  }
  try {
    await deleteThreadsPost(creds.accessToken, threadsPostId);
    await c.env.DB.prepare('DELETE FROM posts WHERE threads_post_id = ?').bind(threadsPostId).run();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to delete Threads post' }, 400);
  }
});

// --- Scoreboard ---
app.get('/api/scoreboard', async (c) => {
  const latestMetricsCte = `
    WITH latest_metrics AS (
      SELECT m.post_id, m.views, m.likes, m.replies, m.reposts, m.quotes
      FROM post_metrics m
      INNER JOIN (
        SELECT post_id, MAX(fetched_at) AS max_fetched
        FROM post_metrics
        GROUP BY post_id
      ) latest ON latest.post_id = m.post_id AND latest.max_fetched = m.fetched_at
    )
  `;

  const summary = await c.env.DB.prepare(
    `${latestMetricsCte}
     SELECT
       COUNT(CASE WHEN p.status = 'published' THEN 1 END) AS total_published,
       COUNT(CASE WHEN p.status = 'scheduled' THEN 1 END) AS total_scheduled,
       COUNT(CASE WHEN p.status = 'draft' THEN 1 END) AS total_drafts,
       COALESCE(SUM(lm.views), 0) AS total_views,
       COALESCE(SUM(lm.likes), 0) AS total_likes,
       COALESCE(SUM(lm.replies), 0) AS total_replies,
       COALESCE(SUM(lm.reposts), 0) AS total_reposts,
       COALESCE(SUM(lm.quotes), 0) AS total_quotes
     FROM posts p
     LEFT JOIN latest_metrics lm ON lm.post_id = p.id`
  ).first<Record<string, number>>();

  const byExperiment = await c.env.DB.prepare(
    `${latestMetricsCte}
     SELECT
       e.id,
       e.name,
       e.active,
       COUNT(CASE WHEN p.status = 'published' THEN 1 END) AS published_count,
       COALESCE(AVG(CASE WHEN p.status = 'published' THEN lm.views END), 0) AS avg_views,
       COALESCE(AVG(CASE WHEN p.status = 'published' THEN lm.replies END), 0) AS avg_replies,
       COALESCE(AVG(CASE WHEN p.status = 'published' THEN lm.likes END), 0) AS avg_likes,
       COALESCE(SUM(lm.views), 0) AS total_views,
       COALESCE(SUM(lm.replies), 0) AS total_replies
     FROM experiments e
     LEFT JOIN posts p ON p.experiment_id = e.id
     LEFT JOIN latest_metrics lm ON lm.post_id = p.id
     GROUP BY e.id
     ORDER BY avg_replies DESC, avg_views DESC`
  ).all<Record<string, unknown>>();

  const byHookType = await c.env.DB.prepare(
    `${latestMetricsCte}
     SELECT
       p.hook_type,
       COUNT(CASE WHEN p.status = 'published' THEN 1 END) AS published_count,
       COALESCE(AVG(CASE WHEN p.status = 'published' THEN lm.views END), 0) AS avg_views,
       COALESCE(AVG(CASE WHEN p.status = 'published' THEN lm.replies END), 0) AS avg_replies,
       COALESCE(AVG(CASE WHEN p.status = 'published' THEN lm.likes END), 0) AS avg_likes
     FROM posts p
     LEFT JOIN latest_metrics lm ON lm.post_id = p.id
     WHERE p.status = 'published'
     GROUP BY p.hook_type
     ORDER BY avg_replies DESC, avg_views DESC`
  ).all<Record<string, unknown>>();

  return c.json({
    summary: summary ?? {
      total_published: 0,
      total_scheduled: 0,
      total_drafts: 0,
      total_views: 0,
      total_likes: 0,
      total_replies: 0,
      total_reposts: 0,
      total_quotes: 0,
    },
    byExperiment: byExperiment.results,
    byHookType: byHookType.results,
  });
});

// --- Experiments ---
app.get('/api/experiments', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM experiments ORDER BY created_at DESC'
  ).all<ExperimentRow>();
  return c.json({ experiments: results });
});

app.post('/api/experiments', async (c) => {
  const body = await c.req.json<{
    name?: string;
    problem_angle?: string;
    target_audience?: string;
    tone?: string;
    auto_generate?: boolean;
  }>();

  const name = body.name?.trim();
  const problemAngle = body.problem_angle?.trim();
  const targetAudience = body.target_audience?.trim();
  if (!name || !problemAngle || !targetAudience) {
    return c.json({ error: 'name, problem_angle, and target_audience are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO experiments (id, name, problem_angle, target_audience, tone, active, auto_generate, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  )
    .bind(
      id,
      name,
      problemAngle,
      targetAudience,
      body.tone?.trim() || 'santai-tajam',
      body.auto_generate ? 1 : 0,
      now
    )
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM experiments WHERE id = ?')
    .bind(id)
    .first<ExperimentRow>();
  return c.json({ experiment: created }, 201);
});

app.patch('/api/experiments/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM experiments WHERE id = ?')
    .bind(id)
    .first<ExperimentRow>();
  if (!existing) return c.json({ error: 'Experiment not found' }, 404);

  const body = await c.req.json<{
    name?: string;
    problem_angle?: string;
    target_audience?: string;
    tone?: string;
    active?: boolean;
    auto_generate?: boolean;
  }>();

  await c.env.DB.prepare(
    'UPDATE experiments SET name = ?, problem_angle = ?, target_audience = ?, tone = ?, active = ?, auto_generate = ? WHERE id = ?'
  )
    .bind(
      body.name?.trim() ?? existing.name,
      body.problem_angle?.trim() ?? existing.problem_angle,
      body.target_audience?.trim() ?? existing.target_audience,
      body.tone?.trim() ?? existing.tone,
      typeof body.active === 'boolean' ? (body.active ? 1 : 0) : existing.active,
      typeof body.auto_generate === 'boolean'
        ? body.auto_generate
          ? 1
          : 0
        : existing.auto_generate,
      id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM experiments WHERE id = ?')
    .bind(id)
    .first<ExperimentRow>();
  return c.json({ experiment: updated });
});

app.delete('/api/experiments/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM experiments WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// --- Posts & AI Generation ---
app.get('/api/posts', async (c) => {
  const status = c.req.query('status');
  const filterSql =
    status && ['draft', 'scheduled', 'publishing', 'published', 'failed'].includes(status)
      ? 'WHERE p.status = ?'
      : '';

  const sql = `
    WITH latest_metrics AS (
      SELECT m.post_id, m.views, m.likes, m.replies, m.reposts, m.quotes, m.fetched_at
      FROM post_metrics m
      INNER JOIN (
        SELECT post_id, MAX(fetched_at) AS max_fetched
        FROM post_metrics
        GROUP BY post_id
      ) latest ON latest.post_id = m.post_id AND latest.max_fetched = m.fetched_at
    )
    SELECT
      p.*,
      e.name AS experiment_name,
      lm.views,
      lm.likes,
      lm.replies,
      lm.reposts,
      lm.quotes,
      lm.fetched_at AS metrics_fetched_at
    FROM posts p
    LEFT JOIN experiments e ON e.id = p.experiment_id
    LEFT JOIN latest_metrics lm ON lm.post_id = p.id
    ${filterSql}
    ORDER BY COALESCE(p.scheduled_at, p.published_at, p.created_at) DESC
    LIMIT 100
  `;

  const stmt = c.env.DB.prepare(sql);
  const { results } = filterSql
    ? await stmt.bind(status).all<Record<string, unknown>>()
    : await stmt.all<Record<string, unknown>>();

  return c.json({ posts: results });
});

app.post('/api/posts', async (c) => {
  const body = await c.req.json<{
    experiment_id?: string | null;
    hook_type?: HookType;
    parts?: string[];
    status?: 'draft' | 'scheduled';
    scheduled_at?: number | null;
  }>();

  const parts = (body.parts ?? []).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0 || parts.length > 5) {
    return c.json({ error: 'Post must have 1 to 5 non-empty parts' }, 400);
  }
  for (const part of parts) {
    if (part.length > 500) {
      return c.json({ error: 'Each part must be 500 characters or fewer' }, 400);
    }
  }

  const status = body.status === 'scheduled' && body.scheduled_at ? 'scheduled' : 'draft';
  const id = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(
    'INSERT INTO posts (id, experiment_id, hook_type, parts_json, status, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      id,
      body.experiment_id || null,
      body.hook_type || 'pain_point',
      JSON.stringify(parts),
      status,
      status === 'scheduled' ? body.scheduled_at : null,
      now,
      now
    )
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
  return c.json({ post: created }, 201);
});

app.patch('/api/posts/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
  if (!existing) return c.json({ error: 'Post not found' }, 404);

  const body = await c.req.json<{
    parts?: string[];
    hook_type?: HookType;
    status?: 'draft' | 'scheduled';
    scheduled_at?: number | null;
  }>();

  let partsJson = existing.parts_json;
  if (Array.isArray(body.parts)) {
    const cleaned = body.parts.map((p) => p.trim()).filter((p) => p.length > 0);
    if (cleaned.length === 0 || cleaned.length > 5 || cleaned.some((p) => p.length > 500)) {
      return c.json({ error: 'Invalid parts (1-5 parts, <=500 chars each)' }, 400);
    }
    partsJson = JSON.stringify(cleaned);
  }

  const nextStatus =
    body.status === 'scheduled' && body.scheduled_at
      ? 'scheduled'
      : body.status === 'draft'
        ? 'draft'
        : existing.status;

  await c.env.DB.prepare(
    'UPDATE posts SET parts_json = ?, hook_type = ?, status = ?, scheduled_at = ?, last_error = NULL, updated_at = ? WHERE id = ?'
  )
    .bind(
      partsJson,
      body.hook_type ?? existing.hook_type,
      nextStatus,
      nextStatus === 'scheduled' ? (body.scheduled_at ?? existing.scheduled_at) : null,
      Date.now(),
      id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
  return c.json({ post: updated });
});

app.delete('/api/posts/:id', async (c) => {
  const id = c.req.param('id');
  const deleteRemote = c.req.query('remote') === '1';

  if (deleteRemote) {
    const existing = await c.env.DB.prepare('SELECT threads_post_id FROM posts WHERE id = ?')
      .bind(id)
      .first<{ threads_post_id: string | null }>();
    if (existing?.threads_post_id) {
      const creds = await getActiveAccessToken(c.env);
      if (!creds) {
        return c.json({ error: 'Threads account is not connected' }, 400);
      }
      try {
        await deleteThreadsPost(creds.accessToken, existing.threads_post_id);
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : 'Failed to delete Threads post' },
          400
        );
      }
    }
  }

  await c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.post('/api/posts/generate', async (c) => {
  const body = await c.req.json<{
    experiment_id?: string;
    hook_type?: HookType;
    count?: number;
    is_chain?: boolean;
  }>();

  if (!body.experiment_id) {
    return c.json({ error: 'experiment_id is required' }, 400);
  }
  const experiment = await c.env.DB.prepare('SELECT * FROM experiments WHERE id = ?')
    .bind(body.experiment_id)
    .first<ExperimentRow>();
  if (!experiment) {
    return c.json({ error: 'Experiment not found' }, 404);
  }

  try {
    const drafts = await generateHookDrafts(c.env, {
      experiment,
      hookType: body.hook_type || 'pain_point',
      count: body.count ?? 4,
      isChain: Boolean(body.is_chain),
    });
    return c.json({ drafts });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'AI generation failed' }, 400);
  }
});

app.post('/api/posts/:id/publish-now', async (c) => {
  const id = c.req.param('id');
  try {
    const outcome = await publishSinglePost(c.env, id);
    if (outcome.status === 'failed') {
      return c.json({ error: outcome.error || 'Publish failed', outcome }, 400);
    }
    return c.json({ ok: true, outcome });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Publish failed' }, 400);
  }
});

// --- Manual Job Triggers ---
app.post('/api/jobs/publish-due', async (c) => {
  const result = await runPublishDuePosts(c.env);
  return c.json(result);
});

app.post('/api/jobs/sync-metrics', async (c) => {
  const result = await runSyncInsights(c.env);
  return c.json(result);
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const d = new Date(controller.scheduledTime);
    const hour = d.getUTCHours();
    const minute = d.getUTCMinutes();

    const tasks: Array<Promise<unknown>> = [runPublishDuePosts(env)];
    if (minute === 0 && hour % 2 === 0) {
      tasks.push(runSyncInsights(env));
    }
    if (hour === 1 && minute === 0) {
      tasks.push(runDailyMaintenance(env));
    }

    ctx.waitUntil(Promise.all(tasks));
  },
};
