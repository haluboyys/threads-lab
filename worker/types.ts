export type HookType =
  | 'pain_point'
  | 'hot_take'
  | 'question'
  | 'mini_story'
  | 'build_in_public';

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  TOKEN_ENCRYPTION_KEY: string;
  THREADS_APP_ID?: string;
  THREADS_APP_SECRET?: string;
  THREADS_REDIRECT_URI?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
}

export interface ThreadsAuthRow {
  id: number;
  threads_user_id: string;
  username: string;
  access_token_enc: string;
  expires_at: number;
  updated_at: number;
}

export interface ExperimentRow {
  id: string;
  name: string;
  problem_angle: string;
  target_audience: string;
  tone: string;
  active: number;
  auto_generate: number;
  created_at: number;
}

export interface PostRow {
  id: string;
  experiment_id: string | null;
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
}

export interface PostMetricsRow {
  id: number;
  post_id: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  fetched_at: number;
}
