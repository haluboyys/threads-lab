export type HookType =
  | 'pain_point'
  | 'hot_take'
  | 'question'
  | 'mini_story'
  | 'build_in_public';

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

export interface Experiment {
  id: string;
  name: string;
  problem_angle: string;
  target_audience: string;
  tone: string;
  active: number;
  auto_generate: number;
  created_at: number;
}

export interface PostItem {
  id: string;
  experiment_id: string | null;
  experiment_name?: string | null;
  hook_type: HookType;
  parts_json: string;
  status: PostStatus;
  scheduled_at: number | null;
  threads_post_id: string | null;
  published_at: number | null;
  retry_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  views?: number | null;
  likes?: number | null;
  replies?: number | null;
  reposts?: number | null;
  quotes?: number | null;
}

export interface LiveThreadsPost {
  id: string;
  text?: string;
  media_type?: string;
  timestamp?: string;
  permalink?: string;
}

export interface ThreadsStatus {
  connected: boolean;
  oauthConfigured: boolean;
  llmConfigured: boolean;
  llmModel: string;
  account: {
    threadsUserId: string;
    username: string;
    expiresAt: number;
    updatedAt: number;
  } | null;
}

export interface ScoreboardData {
  summary: {
    total_published: number;
    total_scheduled: number;
    total_drafts: number;
    total_views: number;
    total_likes: number;
    total_replies: number;
    total_reposts: number;
    total_quotes: number;
  };
  byExperiment: Array<{
    id: string;
    name: string;
    active: number;
    published_count: number;
    avg_views: number;
    avg_replies: number;
    avg_likes: number;
    total_views: number;
    total_replies: number;
  }>;
  byHookType: Array<{
    hook_type: HookType;
    published_count: number;
    avg_views: number;
    avg_replies: number;
    avg_likes: number;
  }>;
}

export const HOOK_LABELS: Record<HookType, string> = {
  pain_point: 'Pain Point',
  hot_take: 'Hot Take',
  question: 'Question',
  mini_story: 'Mini Story',
  build_in_public: 'Build in Public',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  me: () => request<{ authenticated: boolean }>('/api/auth/me'),
  login: (password: string) =>
    request<{ authenticated: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  threadsStatus: () => request<ThreadsStatus>('/api/threads/status'),
  threadsConnectUrl: () => request<{ url: string }>('/api/threads/connect'),
  threadsDisconnect: () => request<{ ok: boolean }>('/api/threads/disconnect', { method: 'DELETE' }),
  listLiveThreads: () => request<{ posts: LiveThreadsPost[] }>('/api/threads/posts'),
  deleteLiveThread: (threadsPostId: string) =>
    request<{ ok: boolean }>(`/api/threads/posts/${encodeURIComponent(threadsPostId)}`, {
      method: 'DELETE',
    }),

  scoreboard: () => request<ScoreboardData>('/api/scoreboard'),

  listExperiments: () => request<{ experiments: Experiment[] }>('/api/experiments'),
  createExperiment: (payload: {
    name: string;
    problem_angle: string;
    target_audience: string;
    tone?: string;
    auto_generate?: boolean;
  }) =>
    request<{ experiment: Experiment }>('/api/experiments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateExperiment: (id: string, payload: Partial<{ active: boolean; auto_generate: boolean }>) =>
    request<{ experiment: Experiment }>(`/api/experiments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteExperiment: (id: string) =>
    request<{ ok: boolean }>(`/api/experiments/${id}`, { method: 'DELETE' }),

  listPosts: (status?: string) =>
    request<{ posts: PostItem[] }>(status ? `/api/posts?status=${encodeURIComponent(status)}` : '/api/posts'),
  createPost: (payload: {
    experiment_id?: string | null;
    hook_type: HookType;
    parts: string[];
    status: 'draft' | 'scheduled';
    scheduled_at?: number | null;
  }) =>
    request<{ post: PostItem }>('/api/posts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePost: (
    id: string,
    payload: Partial<{
      parts: string[];
      hook_type: HookType;
      status: 'draft' | 'scheduled';
      scheduled_at: number | null;
    }>
  ) =>
    request<{ post: PostItem }>(`/api/posts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deletePost: (id: string, remote = false) =>
    request<{ ok: boolean }>(`/api/posts/${id}${remote ? '?remote=1' : ''}`, { method: 'DELETE' }),
  generateDrafts: (payload: {
    experiment_id: string;
    hook_type: HookType;
    count: number;
    is_chain: boolean;
  }) =>
    request<{ drafts: Array<{ hook_type: HookType; parts: string[] }> }>('/api/posts/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  publishNow: (id: string) =>
    request<{ ok: boolean }>(`/api/posts/${id}/publish-now`, { method: 'POST' }),

  runDueQueue: () =>
    request<{ processed: number; published: number; failed: number }>('/api/jobs/publish-due', {
      method: 'POST',
    }),
  syncMetrics: () => request<{ synced: number }>('/api/jobs/sync-metrics', { method: 'POST' }),
};

export function formatWib(ms: number | null | undefined): string {
  if (!ms) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms)) + ' WIB';
}

export function nextWibSlotLocalInput(hourWib: number, minuteWib = 0): string {
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffsetMs);
  const target = new Date(wibNow);
  target.setUTCHours(hourWib, minuteWib, 0, 0);
  if (target.getTime() <= wibNow.getTime() + 5 * 60_000) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  const hh = String(target.getUTCHours()).padStart(2, '0');
  const min = String(target.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}
