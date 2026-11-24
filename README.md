# threads.lab

Personal market-research & AI auto-post dashboard for **Meta Threads**, built to run on **Cloudflare Workers Free Tier** (Workers + Static Assets + D1 + 3 Cron Triggers).

## Features

- **Market Scoreboard**: Compare `views`, `likes`, `replies`, and engagement rate by SaaS topic and by hook type (`pain_point`, `hot_take`, `question`, `mini_story`, `build_in_public`).
- **AI Draft Studio**: Generate Indonesian hook variations or 2–3 part thread chains using any OpenAI-compatible API (DeepSeek, OpenAI, Groq, GLM, etc.).
- **Queue & Cron Automation**:
  - `*/5 * * * *`: Publish up to 3 due scheduled posts (with automatic retry on transient failure).
  - `0 */2 * * *`: Fetch Threads `/insights` snapshots for posts from the last 7 days.
  - `0 1 * * *`: Refresh long-lived Threads token before expiry + optional daily auto-drafts.
- **Encrypted Token Storage**: Threads OAuth tokens are encrypted at rest in D1 with AES-256-GCM.

## Setup

### 1. Install & Create D1 Database

```bash
npm install
npx wrangler d1 create threads-lab-db
```

Copy the printed `database_id` into [wrangler.jsonc](wrangler.jsonc), then apply the schema locally and remotely:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

### 2. Configure Secrets

Copy `.dev.vars.example` to `.dev.vars` for local development:

```bash
cp .dev.vars.example .dev.vars
```

For production on Cloudflare Workers, set each secret via Wrangler:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put THREADS_APP_ID
npx wrangler secret put THREADS_APP_SECRET
npx wrangler secret put THREADS_REDIRECT_URI
npx wrangler secret put LLM_BASE_URL
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_MODEL
```

### 3. Meta Threads Developer Setup

1. Create an app at Meta for Developers with the **Access the Threads API** use case.
2. Enable `threads_basic`, `threads_content_publish`, and `threads_manage_insights`.
3. Add your callback URL (`https://<your-worker>.workers.dev/api/threads/callback`) to **Redirect Callback URLs**.
4. Add your personal Threads account under **App roles → Roles → Threads Tester**, then accept the invite inside Threads (**Settings → Account → Website Permissions → Invites**).

## Local Development

Run the Worker API and Vite UI in separate terminals:

```bash
npm run dev:worker
npm run dev:client
```

## Deploy

```bash
npm run deploy
```
