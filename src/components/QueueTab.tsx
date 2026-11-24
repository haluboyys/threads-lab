import { Play, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, formatWib, HOOK_LABELS, type PostItem } from '../lib/api';

const FILTERS = ['all', 'scheduled', 'published', 'draft', 'failed'] as const;

export function QueueTab({ refreshSignal }: { refreshSignal: number }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listPosts(filter === 'all' ? undefined : filter);
      setPosts(res.posts);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal memuat queue');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const handlePublishNow = async (id: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      await api.publishNow(id);
      setNotice('Berhasil dipublish ke Threads.');
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal publish');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await api.deletePost(id);
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  const handleRunQueue = async () => {
    setNotice(null);
    try {
      const res = await api.runDueQueue();
      setNotice(`Queue diproses: ${res.processed} | Published: ${res.published} | Failed: ${res.failed}`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal menjalankan queue');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Queue &amp; Monitor</h2>
          <p className="font-mono-tech text-xs text-[var(--muted)]">
            Cron publish otomatis berjalan tiap 5 menit di Cloudflare Workers.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRunQueue}
            className="brutal-btn font-mono-tech inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-1.5 text-xs font-bold"
          >
            <Play className="h-3.5 w-3.5" />
            <span>Run Due Queue</span>
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="brutal-btn font-mono-tech inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--surface)] px-3 py-1.5 text-xs font-bold"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`font-mono-tech border-2 border-[var(--ink)] px-2.5 py-1 text-xs font-bold uppercase ${
              filter === f ? 'bg-[var(--ink)] text-[var(--surface)]' : 'bg-[var(--surface)]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {notice && (
        <div className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-2 text-xs font-bold">
          {notice}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
          Belum ada post pada filter ini.
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const parts = JSON.parse(post.parts_json) as string[];
            return (
              <div
                key={post.id}
                className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={post.status} />
                    <span className="font-mono-tech border border-[var(--ink)] bg-[var(--bg)] px-2 py-0.5 text-[10px] font-bold">
                      {HOOK_LABELS[post.hook_type] ?? post.hook_type}
                    </span>
                    {post.experiment_name && (
                      <span className="font-mono-tech text-[11px] text-[var(--muted)]">
                        {post.experiment_name}
                      </span>
                    )}
                  </div>

                  <span className="font-mono-tech text-[11px] text-[var(--muted)]">
                    {post.status === 'published'
                      ? `Published: ${formatWib(post.published_at)}`
                      : post.status === 'scheduled'
                        ? `Scheduled: ${formatWib(post.scheduled_at)}`
                        : `Created: ${formatWib(post.created_at)}`}
                  </span>
                </div>

                <div className="space-y-1.5 text-sm">
                  {parts.map((p, i) => (
                    <p key={i} className="whitespace-pre-wrap border-l-2 border-[var(--ink)] pl-2.5">
                      {p}
                    </p>
                  ))}
                </div>

                {post.last_error && (
                  <div className="font-mono-tech mt-2 border-2 border-[var(--ink)] bg-[var(--accent-2)] px-2.5 py-1.5 text-xs font-bold">
                    Error: {post.last_error} (retry {post.retry_count})
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t-2 border-[var(--ink)]/20 pt-2.5">
                  <div className="font-mono-tech text-xs text-[var(--muted)]">
                    {post.status === 'published'
                      ? `Views: ${post.views ?? 0} • Likes: ${post.likes ?? 0} • Replies: ${post.replies ?? 0} • Reposts: ${post.reposts ?? 0}`
                      : `${parts.length} part`}
                  </div>

                  <div className="flex gap-2">
                    {post.status !== 'published' && (
                      <button
                        type="button"
                        disabled={busyId === post.id}
                        onClick={() => handlePublishNow(post.id)}
                        className="brutal-btn font-mono-tech inline-flex items-center gap-1 border-2 border-[var(--ink)] bg-[var(--accent)] px-2.5 py-1 text-xs font-bold"
                      >
                        <Send className="h-3 w-3" />
                        <span>{post.status === 'failed' ? 'Retry Now' : 'Publish Now'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === post.id}
                      onClick={() => handleDelete(post.id)}
                      className="brutal-btn font-mono-tech inline-flex items-center gap-1 border-2 border-[var(--ink)] bg-[var(--bg)] px-2.5 py-1 text-xs font-bold"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Hapus</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PostItem['status'] }) {
  const style =
    status === 'published'
      ? 'bg-[#86efac]'
      : status === 'scheduled'
        ? 'bg-[var(--accent)]'
        : status === 'failed'
          ? 'bg-[var(--accent-2)]'
          : 'bg-[var(--bg)]';

  return (
    <span className={`font-mono-tech border-2 border-[var(--ink)] px-2 py-0.5 text-[10px] font-bold uppercase ${style}`}>
      {status}
    </span>
  );
}
