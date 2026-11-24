import { describe, expect, it, vi } from 'vitest';
import type { Env, PostRow } from '../types';
import { decryptSecret, encryptSecret, signSession, verifySession } from './crypto';
import { runPublishDuePosts } from './jobs';
import { parseLlmDrafts } from './llm';
import type { ThreadsPublisher } from './threads';

function createMockDb(initialPosts: PostRow[], encryptedToken: string) {
  const posts = new Map<string, PostRow>(initialPosts.map((p) => [p.id, { ...p }]));

  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...params: unknown[]) {
        args = params;
        return stmt;
      },
      async first<T>() {
        if (sql.includes('FROM threads_auth')) {
          return {
            id: 1,
            threads_user_id: 'u-1',
            username: 'haluboyys',
            access_token_enc: encryptedToken,
            expires_at: Date.now() + 86_400_000,
            updated_at: Date.now(),
          } as T;
        }
        if (sql.includes('SELECT * FROM posts WHERE id = ?')) {
          const found = posts.get(String(args[0]));
          return (found ? { ...found } : null) as T;
        }
        return null as T;
      },
      async all<T>() {
        if (sql.includes("FROM posts WHERE status = 'scheduled'")) {
          const cutoff = Number(args[0]);
          const limit = Number(args[1]);
          const due = Array.from(posts.values())
            .filter((p) => p.status === 'scheduled' && p.scheduled_at !== null && p.scheduled_at <= cutoff)
            .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0))
            .slice(0, limit)
            .map((p) => ({ id: p.id }));
          return { results: due as T[] };
        }
        return { results: [] as T[] };
      },
      async run() {
        if (sql.includes("SET status = 'publishing'")) {
          const [updatedAt, id] = args as [number, string];
          const p = posts.get(id);
          if (p && ['draft', 'scheduled', 'failed'].includes(p.status)) {
            p.status = 'publishing';
            p.updated_at = updatedAt;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (sql.includes("SET status = 'published'")) {
          const [threadsPostId, publishedAt, updatedAt, id] = args as [string, number, number, string];
          const p = posts.get(id);
          if (p) {
            p.status = 'published';
            p.threads_post_id = threadsPostId;
            p.published_at = publishedAt;
            p.last_error = null;
            p.updated_at = updatedAt;
          }
          return { meta: { changes: 1 } };
        }
        if (sql.includes("SET status = 'scheduled', scheduled_at = ?")) {
          const [scheduledAt, retryCount, lastError, updatedAt, id] = args as [
            number,
            number,
            string,
            number,
            string,
          ];
          const p = posts.get(id);
          if (p) {
            p.status = 'scheduled';
            p.scheduled_at = scheduledAt;
            p.retry_count = retryCount;
            p.last_error = lastError;
            p.updated_at = updatedAt;
          }
          return { meta: { changes: 1 } };
        }
        if (sql.includes("SET status = 'failed'")) {
          const [retryCount, lastError, updatedAt, id] = args as [number, string, number, string];
          const p = posts.get(id);
          if (p) {
            p.status = 'failed';
            p.retry_count = retryCount;
            p.last_error = lastError;
            p.updated_at = updatedAt;
          }
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  };

  return {
    db: { prepare } as unknown as D1Database,
    posts,
  };
}

describe('threads-lab core worker logic', () => {
  it('encrypts and decrypts tokens cleanly and rejects tampering', async () => {
    const key = 'super-secret-test-passphrase-32bytes';
    const enc = await encryptSecret('TH_TOKEN_12345', key);
    expect(enc).not.toContain('TH_TOKEN_12345');

    const dec = await decryptSecret(enc, key);
    expect(dec).toBe('TH_TOKEN_12345');

    const tampered = `${enc.slice(0, -2)}xx`;
    await expect(decryptSecret(tampered, key)).rejects.toThrow();
  });

  it('signs and verifies HMAC session tokens', async () => {
    const secret = 'hmac-secret-key';
    const token = await signSession({ role: 'admin' }, secret, 300);
    const verified = await verifySession<{ role: string }>(token, secret);
    expect(verified?.role).toBe('admin');

    const expired = await signSession({ role: 'admin' }, secret, -10);
    expect(await verifySession(expired, secret)).toBeNull();
    expect(await verifySession(`${token}x`, secret)).toBeNull();
  });

  it('parses fenced LLM JSON and clamps parts to 500 characters', () => {
    const raw = [
      '```json',
      JSON.stringify({
        drafts: [
          { hook_type: 'pain_point', parts: ['a'.repeat(550)] },
          { hook_type: 'unknown_hook', parts: ['  Pertanyaan singkat?  ', ''] },
        ],
      }),
      '```',
    ].join('\n');

    const parsed = parseLlmDrafts(raw, 'question');
    expect(parsed).toHaveLength(2);
    expect(parsed[0].parts[0]).toHaveLength(500);
    expect(parsed[1].hook_type).toBe('question');
    expect(parsed[1].parts).toEqual(['Pertanyaan singkat?']);
  });

  it('publishes due posts, retries transient errors, and marks permanent failures', async () => {
    const key = 'test-encryption-key-32-chars-min';
    const encToken = await encryptSecret('live-token', key);
    const now = Date.now();

    const { db, posts } = createMockDb(
      [
        {
          id: 'p-ok',
          experiment_id: null,
          hook_type: 'pain_point',
          parts_json: JSON.stringify(['Hello market!']),
          status: 'scheduled',
          scheduled_at: now - 1000,
          threads_post_id: null,
          published_at: null,
          retry_count: 0,
          last_error: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'p-retry',
          experiment_id: null,
          hook_type: 'question',
          parts_json: JSON.stringify(['Retry me']),
          status: 'scheduled',
          scheduled_at: now - 500,
          threads_post_id: null,
          published_at: null,
          retry_count: 0,
          last_error: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'p-fail',
          experiment_id: null,
          hook_type: 'hot_take',
          parts_json: JSON.stringify(['Fail me']),
          status: 'scheduled',
          scheduled_at: now - 100,
          threads_post_id: null,
          published_at: null,
          retry_count: 2,
          last_error: null,
          created_at: now,
          updated_at: now,
        },
      ],
      encToken
    );

    const publisher: ThreadsPublisher = {
      publishThreadParts: vi.fn(async (_token, parts) => {
        if (parts[0] === 'Hello market!') {
          return { rootPostId: 'th-101', publishedIds: ['th-101'] };
        }
        throw new Error('Rate limited');
      }),
      fetchThreadInsights: vi.fn(),
      refreshLongLivedToken: vi.fn(),
    };

    const env = {
      DB: db,
      TOKEN_ENCRYPTION_KEY: key,
    } as unknown as Env;

    const result = await runPublishDuePosts(env, publisher);
    expect(result.processed).toBe(3);
    expect(result.published).toBe(1);
    expect(result.failed).toBe(1);

    expect(posts.get('p-ok')?.status).toBe('published');
    expect(posts.get('p-ok')?.threads_post_id).toBe('th-101');

    expect(posts.get('p-retry')?.status).toBe('scheduled');
    expect(posts.get('p-retry')?.retry_count).toBe(1);

    expect(posts.get('p-fail')?.status).toBe('failed');
    expect(posts.get('p-fail')?.last_error).toContain('Rate limited');
  });
});
