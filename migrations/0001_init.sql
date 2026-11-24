-- Threads OAuth credentials (single personal account)
CREATE TABLE IF NOT EXISTS threads_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  threads_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Market-validation topics / SaaS ideas being tested
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  problem_angle TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'santai-tajam',
  active INTEGER NOT NULL DEFAULT 1,
  auto_generate INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Draft, scheduled, published, or failed Threads posts (single or multi-part)
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  experiment_id TEXT REFERENCES experiments(id) ON DELETE SET NULL,
  hook_type TEXT NOT NULL,
  parts_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at INTEGER,
  threads_post_id TEXT,
  published_at INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Periodic insights snapshots per published post
CREATE TABLE IF NOT EXISTS post_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  quotes INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_status_schedule ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_experiment ON posts(experiment_id);
CREATE INDEX IF NOT EXISTS idx_metrics_post_fetched ON post_metrics(post_id, fetched_at DESC);
