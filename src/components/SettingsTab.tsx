import { Link2, Plus, Trash2, Unlink } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatWib, type Experiment, type ThreadsStatus } from '../lib/api';

export function SettingsTab({ onStatusChange }: { onStatusChange: () => void }) {
  const [status, setStatus] = useState<ThreadsStatus | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [name, setName] = useState('');
  const [problemAngle, setProblemAngle] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [tone, setTone] = useState('santai-tajam');
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [st, exp] = await Promise.all([api.threadsStatus(), api.listExperiments()]);
    setStatus(st);
    setExperiments(exp.experiments);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConnect = async () => {
    setNotice(null);
    try {
      const { url } = await api.threadsConnectUrl();
      window.location.href = url;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'OAuth belum dikonfigurasi');
    }
  };

  const handleDisconnect = async () => {
    await api.threadsDisconnect();
    await load();
    onStatusChange();
  };

  const handleCreateExperiment = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      await api.createExperiment({
        name,
        problem_angle: problemAngle,
        target_audience: targetAudience,
        tone,
        auto_generate: autoGenerate,
      });
      setName('');
      setProblemAngle('');
      setTargetAudience('');
      setAutoGenerate(false);
      await load();
      setNotice('Topik eksperimen ditambahkan.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal menambah eksperimen');
    }
  };

  const toggleFlag = async (exp: Experiment, field: 'active' | 'auto_generate') => {
    await api.updateExperiment(exp.id, {
      [field]: exp[field] === 1 ? false : true,
    });
    await load();
  };

  const handleDeleteExp = async (id: string) => {
    await api.deleteExperiment(id);
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Settings &amp; Experiments</h2>
        <p className="font-mono-tech text-xs text-[var(--muted)]">
          Hubungkan akun Threads personal &amp; kelola topik riset pasar.
        </p>
      </div>

      {notice && (
        <div className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-2 text-xs font-bold">
          {notice}
        </div>
      )}

      {/* Threads Connection */}
      <div className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono-tech text-xs font-bold uppercase text-[var(--muted)]">
              Threads OAuth
            </div>
            {status?.connected && status.account ? (
              <div className="mt-1">
                <div className="text-base font-bold">@{status.account.username}</div>
                <div className="font-mono-tech text-xs text-[var(--muted)]">
                  Token berlaku s/d {formatWib(status.account.expiresAt)} (auto-refresh aktif)
                </div>
              </div>
            ) : (
              <div className="mt-1 text-sm text-[var(--muted)]">
                Belum terhubung. Pastikan akun sudah di-accept sebagai Threads Tester di Meta Developers.
              </div>
            )}
          </div>

          {status?.connected ? (
            <button
              type="button"
              onClick={handleDisconnect}
              className="brutal-btn font-mono-tech inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--accent-2)] px-3 py-2 text-xs font-bold"
            >
              <Unlink className="h-3.5 w-3.5" />
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              className="brutal-btn font-mono-tech inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-2 text-xs font-bold"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>Connect Threads</span>
            </button>
          )}
        </div>

        <div className="font-mono-tech mt-3 flex flex-wrap gap-3 border-t-2 border-[var(--ink)]/20 pt-2.5 text-[11px] text-[var(--muted)]">
          <span>OAuth Env: {status?.oauthConfigured ? 'Ready' : 'Missing'}</span>
          <span>•</span>
          <span>
            AI Provider: {status?.llmConfigured ? `Ready (${status.llmModel})` : 'Missing LLM_API_KEY'}
          </span>
        </div>
      </div>

      {/* Add Experiment */}
      <form
        onSubmit={handleCreateExperiment}
        className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4"
      >
        <div className="font-mono-tech mb-3 flex items-center gap-1.5 text-xs font-bold uppercase">
          <Plus className="h-3.5 w-3.5" />
          <span>Tambah Topik Riset Pasar (Ide SaaS)</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="text"
            required
            placeholder="Nama topik (mis. Proposal Freelancer)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-2 border-[var(--ink)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none"
          />
          <input
            type="text"
            required
            placeholder="Target audiens (mis. Freelance dev & designer ID)"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            className="border-2 border-[var(--ink)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none"
          />
          <input
            type="text"
            required
            placeholder="Sudut masalah (mis. Klien ghosting setelah dikasih PDF penawaran)"
            value={problemAngle}
            onChange={(e) => setProblemAngle(e.target.value)}
            className="border-2 border-[var(--ink)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none sm:col-span-2"
          />
          <input
            type="text"
            placeholder="Gaya bahasa (default: santai-tajam)"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="border-2 border-[var(--ink)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none"
          />
          <label className="font-mono-tech flex items-center gap-2 text-xs font-bold">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              className="h-4 w-4 accent-[var(--ink)]"
            />
            <span>Auto-generate 1 draft/hari via cron</span>
          </label>
        </div>

        <button
          type="submit"
          className="brutal-btn font-mono-tech mt-3 border-2 border-[var(--ink)] bg-[var(--accent)] px-4 py-2 text-xs font-bold"
        >
          Simpan Topik
        </button>
      </form>

      {/* Experiments List */}
      <div className="space-y-2.5">
        {experiments.map((exp) => (
          <div
            key={exp.id}
            className="brutal-shadow flex flex-wrap items-center justify-between gap-3 border-2 border-[var(--ink)] bg-[var(--surface)] p-4"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">{exp.name}</div>
              <div className="text-xs text-[var(--muted)]">{exp.problem_angle}</div>
              <div className="font-mono-tech mt-1 text-[11px] text-[var(--muted)]">
                Target: {exp.target_audience} • Tone: {exp.tone}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void toggleFlag(exp, 'active')}
                className={`font-mono-tech border-2 border-[var(--ink)] px-2 py-1 text-[11px] font-bold ${
                  exp.active ? 'bg-[#86efac]' : 'bg-[var(--bg)]'
                }`}
              >
                {exp.active ? 'Active' : 'Paused'}
              </button>
              <button
                type="button"
                onClick={() => void toggleFlag(exp, 'auto_generate')}
                className={`font-mono-tech border-2 border-[var(--ink)] px-2 py-1 text-[11px] font-bold ${
                  exp.auto_generate ? 'bg-[var(--accent)]' : 'bg-[var(--bg)]'
                }`}
              >
                {exp.auto_generate ? 'Auto-Draft ON' : 'Auto-Draft OFF'}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteExp(exp.id)}
                aria-label={`Delete ${exp.name}`}
                className="brutal-btn border-2 border-[var(--ink)] bg-[var(--bg)] p-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
