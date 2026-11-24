import { ExternalLink, Play, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, formatWib, HOOK_LABELS, type LiveThreadsPost, type PostItem } from '../lib/api';

const FILTERS = ['all', 'scheduled', 'published', 'draft', 'failed'] as const;
type QueueView = 'local' | 'live';

export function QueueTab({ refreshSignal }: { refreshSignal: number }) {
  const [view, setView] = useState<QueueView>('local');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [livePosts, setLivePosts] = useState<LiveThreadsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
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

  const loadLive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listLiveThreads();
      setLivePosts(res.posts);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal mengambil post dari Threads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNotice(null);
    if (view === 'local') {
      void loadLocal();
    } else {
      void loadLive();
    }
  }, [view, loadLocal, loadLive, refreshSignal]);

  const handlePublishNow = async (id: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      await api.publishNow(id);
      setNotice('Berhasil dipublish ke Threads.');
      await loadLocal();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal publish');
      await loadLocal();
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteLocal = async (id: string, remote = false) => {
    if (remote && !window.confirm('Yakin hapus post ini secara permanen dari Threads?')) {
      return;
    }
    setBusyId(id);
    setNotice(null);
    try {
      await api.deletePost(id, remote);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      if (remote) {
        setNotice('Post berhasil dihapus dari Threads & antrean lokal.');
      }
    } catch (err) {
      setNotice(formatDeleteError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteLive = async (threadsPostId: string) => {
    if (!window.confirm('Yakin hapus post ini secara permanen dari Threads?')) {
      return;
    }
    setBusyId(threadsPostId);
    setNotice(null);
    try {
      await api.deleteLiveThread(threadsPostId);
      setLivePosts((prev) => prev.filter((p) => p.id !== threadsPostId));
      setNotice('Post berhasil dihapus dari Threads.');
    } catch (err) {
      setNotice(formatDeleteError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRunQueue = async () => {
    setNotice(null);
    try {
      const res = await api.runDueQueue();
      setNotice(`Queue diproses: ${res.processed} | Published: ${res.published} | Failed: ${res.failed}`);
      await loadLocal();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal menjalankan queue');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Queue &amp; Threads Feed</h2>
          <p className="font-mono-tech text-xs text-[var(--muted)]">
            Kelola antrean lokal atau lihat &amp; hapus post yang sudah live di akun Threads kamu.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {view === 'local' && (
            <button
              type="button"
              onClick={handleRunQueue}
              className="brutal-btn font-mono-tech inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-1.5 text-xs font-bold"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Run Due Queue</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void (view === 'local' ? loadLocal() : loadLive())}
            className="brutal-btn font-mono-tech inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--surface)] px-3 py-1.5 text-xs font-bold"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* View Switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex border-2 border-[var(--ink)] bg-[var(--surface)]">
          <button
            type="button"
            onClick={() => setView('local')}
            className={`font-mono-tech px-3 py-1.5 text-xs font-bold ${
              view === 'local' ? 'bg-[var(--accent)] text-[var(--ink)]' : 'bg-[var(--surface)]'
            }`}
          >
            Queue Lokal
          </button>
          <button
            type="button"
            onClick={() => setView('live')}
            className={`font-mono-tech border-l-2 border-[var(--ink)] px-3 py-1.5 text-xs font-bold ${
              view === 'live' ? 'bg-[var(--accent)] text-[var(--ink)]' : 'bg-[var(--surface)]'
            }`}
          >
            Live di Threads
          </button>
        </div>

        {view === 'local' && (
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
        )}
      </div>

      {notice && (
        <div className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-2 text-xs font-bold">
          {notice}
        </div>
      )}

      {view === 'local' ? (
        posts.length === 0 ? (
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

                    <div className="flex flex-wrap gap-2">
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
                      {post.status === 'published' && post.threads_post_id && (
                        <button
                          type="button"
                          disabled={busyId === post.id}
                          onClick={() => void handleDeleteLocal(post.id, true)}
                          className="brutal-btn font-mono-tech inline-flex items-center gap-1 border-2 border-[var(--ink)] bg-[var(--accent-2)] px-2.5 py-1 text-xs font-bold"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Hapus di Threads</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === post.id}
                        onClick={() => void handleDeleteLocal(post.id, false)}
                        className="brutal-btn font-mono-tech inline-flex items-center gap-1 border-2 border-[var(--ink)] bg-[var(--bg)] px-2.5 py-1 text-xs font-bold"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Hapus Lokal</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : livePosts.length === 0 ? (
        <div className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
          {loading ? 'Mengambil postingan dari Threads...' : 'Belum ada postingan di akun Threads ini.'}
        </div>
      ) : (
        <div className="space-y-3">
          {livePosts.map((item) => (
            <div
              key={item.id}
              className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono-tech border-2 border-[var(--ink)] bg-[#86efac] px-2 py-0.5 text-[10px] font-bold uppercase">
                    {item.media_type || 'TEXT'}
                  </span>
                  <span className="font-mono-tech text-[11px] text-[var(--muted)]">
                    ID: {item.id}
                  </span>
                </div>
                <span className="font-mono-tech text-[11px] text-[var(--muted)]">
                  {item.timestamp ? formatWib(Date.parse(item.timestamp)) : '-'}
                </span>
              </div>

              <p className="whitespace-pre-wrap border-l-2 border-[var(--ink)] pl-2.5 text-sm">
                {item.text || '(Media / tanpa teks)'}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t-2 border-[var(--ink)]/20 pt-2.5">
                {item.permalink && (
                  <a
                    href={item.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="brutal-btn font-mono-tech inline-flex items-center gap-1 border-2 border-[var(--ink)] bg-[var(--bg)] px-2.5 py-1 text-xs font-bold"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>Buka di Threads</span>
                  </a>
                )}
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void handleDeleteLive(item.id)}
                  className="brutal-btn font-mono-tech inline-flex items-center gap-1 border-2 border-[var(--ink)] bg-[var(--accent-2)] px-2.5 py-1 text-xs font-bold disabled:opacity-60"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>{busyId === item.id ? 'Menghapus...' : 'Hapus di Threads'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDeleteError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Gagal menghapus post';
  if (/permission|scope|threads_delete|OAuth/i.test(msg)) {
    return `${msg} — Pastikan permission "threads_delete" sudah diaktifkan di Meta Developers, lalu Disconnect & Connect Threads ulang di tab Settings.`;
  }
  return msg;
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
