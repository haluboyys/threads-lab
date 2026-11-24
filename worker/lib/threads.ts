import type { Env } from '../types';

const THREADS_GRAPH = 'https://graph.threads.net';
const THREADS_OAUTH_BASE = 'https://threads.net/oauth/authorize';
const TIMEOUT_MS = 12_000;

export interface ThreadsInsights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

export interface ThreadsPublisher {
  publishThreadParts: (
    accessToken: string,
    parts: string[]
  ) => Promise<{ rootPostId: string; publishedIds: string[] }>;
  fetchThreadInsights: (accessToken: string, threadsPostId: string) => Promise<ThreadsInsights>;
  refreshLongLivedToken: (
    accessToken: string
  ) => Promise<{ accessToken: string; expiresInSeconds: number }>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Threads API non-JSON response (${res.status}): ${text.slice(0, 160)}`);
  }

  if (!res.ok) {
    const msg =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof (data as { error?: { message?: string } }).error?.message === 'string'
        ? (data as { error: { message: string } }).error.message
        : `HTTP ${res.status}`;
    throw new Error(`Threads API error: ${msg}`);
  }
  return data as T;
}

export function buildThreadsAuthorizeUrl(env: Env, state: string): string {
  if (!env.THREADS_APP_ID || !env.THREADS_REDIRECT_URI) {
    throw new Error('THREADS_APP_ID and THREADS_REDIRECT_URI must be configured');
  }
  const params = new URLSearchParams({
    client_id: env.THREADS_APP_ID,
    redirect_uri: env.THREADS_REDIRECT_URI,
    scope: 'threads_basic,threads_content_publish,threads_manage_insights,threads_delete',
    response_type: 'code',
    state,
  });
  return `${THREADS_OAUTH_BASE}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  env: Env,
  rawCode: string
): Promise<{
  threadsUserId: string;
  username: string;
  accessToken: string;
  expiresInSeconds: number;
}> {
  if (!env.THREADS_APP_ID || !env.THREADS_APP_SECRET || !env.THREADS_REDIRECT_URI) {
    throw new Error('Threads OAuth environment variables are not configured');
  }

  const code = rawCode.replace(/#_$/, '').trim();
  const body = new URLSearchParams({
    client_id: env.THREADS_APP_ID,
    client_secret: env.THREADS_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: env.THREADS_REDIRECT_URI,
    code,
  });

  const shortToken = await fetchJson<{ access_token: string }>(
    `${THREADS_GRAPH}/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }
  );

  const exchangeUrl = new URL(`${THREADS_GRAPH}/access_token`);
  exchangeUrl.searchParams.set('grant_type', 'th_exchange_token');
  exchangeUrl.searchParams.set('client_secret', env.THREADS_APP_SECRET);
  exchangeUrl.searchParams.set('access_token', shortToken.access_token);

  const longToken = await fetchJson<{ access_token: string; expires_in?: number }>(
    exchangeUrl.toString()
  );

  const meUrl = new URL(`${THREADS_GRAPH}/v1.0/me`);
  meUrl.searchParams.set('fields', 'id,username');
  meUrl.searchParams.set('access_token', longToken.access_token);

  const profile = await fetchJson<{ id: string; username?: string }>(meUrl.toString());

  return {
    threadsUserId: profile.id,
    username: profile.username ?? profile.id,
    accessToken: longToken.access_token,
    expiresInSeconds: longToken.expires_in ?? 60 * 24 * 60 * 60,
  };
}

export async function refreshLongLivedToken(accessToken: string): Promise<{
  accessToken: string;
  expiresInSeconds: number;
}> {
  const url = new URL(`${THREADS_GRAPH}/refresh_access_token`);
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', accessToken);

  const data = await fetchJson<{ access_token: string; expires_in?: number }>(url.toString());
  return {
    accessToken: data.access_token,
    expiresInSeconds: data.expires_in ?? 60 * 24 * 60 * 60,
  };
}

export async function publishThreadParts(
  accessToken: string,
  parts: string[]
): Promise<{ rootPostId: string; publishedIds: string[] }> {
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length === 0 || cleaned.length > 5) {
    throw new Error('Thread must contain between 1 and 5 non-empty parts');
  }
  for (const part of cleaned) {
    if (part.length > 500) {
      throw new Error('Each Threads post part must be 500 characters or fewer');
    }
  }

  const publishedIds: string[] = [];
  let replyToId: string | undefined;

  for (const text of cleaned) {
    const createParams = new URLSearchParams({
      media_type: 'TEXT',
      text,
      access_token: accessToken,
    });
    if (replyToId) {
      createParams.set('reply_to_id', replyToId);
    }

    const container = await fetchJson<{ id: string }>(`${THREADS_GRAPH}/v1.0/me/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createParams.toString(),
    });

    const publishParams = new URLSearchParams({
      creation_id: container.id,
      access_token: accessToken,
    });
    const published = await fetchJson<{ id: string }>(
      `${THREADS_GRAPH}/v1.0/me/threads_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: publishParams.toString(),
      }
    );

    publishedIds.push(published.id);
    replyToId = published.id;
  }

  return {
    rootPostId: publishedIds[0],
    publishedIds,
  };
}

export async function fetchThreadInsights(
  accessToken: string,
  threadsPostId: string
): Promise<ThreadsInsights> {
  const url = new URL(`${THREADS_GRAPH}/v1.0/${encodeURIComponent(threadsPostId)}/insights`);
  url.searchParams.set('metric', 'views,likes,replies,reposts,quotes');
  url.searchParams.set('access_token', accessToken);

  const res = await fetchJson<{
    data?: Array<{ name?: string; values?: Array<{ value?: number }> }>;
  }>(url.toString());

  const metrics: ThreadsInsights = {
    views: 0,
    likes: 0,
    replies: 0,
    reposts: 0,
    quotes: 0,
  };

  for (const item of res.data ?? []) {
    const val = item.values?.[0]?.value;
    if (typeof val !== 'number') continue;
    if (item.name === 'views') metrics.views = val;
    if (item.name === 'likes') metrics.likes = val;
    if (item.name === 'replies') metrics.replies = val;
    if (item.name === 'reposts') metrics.reposts = val;
    if (item.name === 'quotes') metrics.quotes = val;
  }

  return metrics;
}

export interface LiveThreadsPost {
  id: string;
  text?: string;
  media_type?: string;
  timestamp?: string;
  permalink?: string;
}

export async function fetchUserThreads(
  accessToken: string,
  limit = 25
): Promise<LiveThreadsPost[]> {
  const url = new URL(`${THREADS_GRAPH}/v1.0/me/threads`);
  url.searchParams.set('fields', 'id,media_type,text,timestamp,permalink');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('access_token', accessToken);

  const res = await fetchJson<{ data?: LiveThreadsPost[] }>(url.toString());
  return res.data ?? [];
}

export async function deleteThreadsPost(
  accessToken: string,
  threadsPostId: string
): Promise<{ success: boolean }> {
  const url = new URL(`${THREADS_GRAPH}/v1.0/${encodeURIComponent(threadsPostId)}`);
  url.searchParams.set('access_token', accessToken);

  await fetchJson<{ success?: boolean }>(url.toString(), {
    method: 'DELETE',
  });
  return { success: true };
}

export const defaultThreadsPublisher: ThreadsPublisher = {
  publishThreadParts,
  fetchThreadInsights,
  refreshLongLivedToken,
};
