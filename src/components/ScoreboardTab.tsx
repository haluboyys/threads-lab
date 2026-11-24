import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, HOOK_LABELS, type ScoreboardData } from '../lib/api';

export function ScoreboardTab() {
  const [data, setData] = useState<ScoreboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.scoreboard();
      setData(res);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Gagal memuat scoreboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await api.syncMetrics();
      setMessage(`Metrics synced untuk ${res.synced} post.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sync gagal');
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !data) {
    return <div className="font-mono-tech py-10 text-sm text-[var(--muted)]">Loading scoreboard...</div>;
  }

  const s = data?.summary;
  const engRate =
    s && s.total_views > 0
      ? (((s.total_likes + s.total_replies + s.total_reposts + s.total_quotes) / s.total_views) * 100).toFixed(2)
      : '0.00';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Market Scoreboard</h2>
          <p className="font-mono-tech text-xs text-[var(--muted)]">
            Bandingkan topik ide &amp; tipe hook mana yang paling memancing diskusi.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="brutal-btn font-mono-tech inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--surface)] px-3 py-1.5 text-xs font-bold disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>{syncing ? 'Syncing...' : 'Sync Insights'}</span>
        </button>
      </div>

      {message && (
        <div className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-2 text-xs font-bold">
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Published" value={String(s?.total_published ?? 0)} sub={`${s?.total_scheduled ?? 0} scheduled`} tone="bg-[var(--surface)]" />
        <KpiCard label="Total Views" value={String(s?.total_views ?? 0)} sub={`${s?.total_likes ?? 0} likes`} tone="bg-[var(--accent)]" />
        <KpiCard label="Total Replies" value={String(s?.total_replies ?? 0)} sub="Sinyal diskusi" tone="bg-[var(--accent-3)]" />
        <KpiCard label="Engagement" value={`${engRate}%`} sub={`${s?.total_reposts ?? 0} reposts`} tone="bg-[var(--surface)]" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4">
          <h3 className="font-mono-tech mb-3 border-b-2 border-[var(--ink)] pb-2 text-xs font-bold uppercase">
            Performa per Topik Ide
          </h3>
          {!data || data.byExperiment.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Belum ada eksperimen. Tambahkan topik di tab Settings.
            </p>
          ) : (
            <div className="space-y-2.5">
              {data.byExperiment.map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center justify-between gap-2 border-2 border-[var(--ink)] bg-[var(--bg)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{exp.name}</div>
                    <div className="font-mono-tech text-[11px] text-[var(--muted)]">
                      {exp.published_count} posts • total {exp.total_views} views
                    </div>
                  </div>
                  <div className="font-mono-tech shrink-0 text-right text-xs font-bold">
                    <div>{Math.round(exp.avg_replies * 10) / 10} avg replies</div>
                    <div className="text-[11px] text-[var(--muted)]">{Math.round(exp.avg_views)} avg views</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4">
          <h3 className="font-mono-tech mb-3 border-b-2 border-[var(--ink)] pb-2 text-xs font-bold uppercase">
            Performa per Tipe Hook
          </h3>
          {!data || data.byHookType.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Publish beberapa post terlebih dahulu untuk melihat hook terbaik.
            </p>
          ) : (
            <div className="space-y-2.5">
              {data.byHookType.map((h) => (
                <div
                  key={h.hook_type}
                  className="flex items-center justify-between gap-2 border-2 border-[var(--ink)] bg-[var(--bg)] px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-bold">{HOOK_LABELS[h.hook_type] ?? h.hook_type}</div>
                    <div className="font-mono-tech text-[11px] text-[var(--muted)]">
                      {h.published_count} published
                    </div>
                  </div>
                  <div className="font-mono-tech text-right text-xs font-bold">
                    <div>{Math.round(h.avg_replies * 10) / 10} avg replies</div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {Math.round(h.avg_views)} views • {Math.round(h.avg_likes * 10) / 10} likes
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className={`brutal-shadow border-2 border-[var(--ink)] p-4 ${tone}`}>
      <div className="font-mono-tech text-[11px] font-bold uppercase opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      <div className="font-mono-tech mt-1 text-[11px] opacity-75">{sub}</div>
    </div>
  );
}
