import { Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  api,
  HOOK_LABELS,
  nextWibSlotLocalInput,
  type Experiment,
  type HookType,
} from '../lib/api';

interface EditableDraft {
  key: string;
  hook_type: HookType;
  parts: string[];
  scheduledAtInput: string;
  saving?: boolean;
}

export function StudioTab({ onSaved }: { onSaved: () => void }) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedExp, setSelectedExp] = useState('');
  const [hookType, setHookType] = useState<HookType>('pain_point');
  const [count, setCount] = useState(4);
  const [isChain, setIsChain] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [manualText, setManualText] = useState('');
  const [manualSchedule, setManualSchedule] = useState(() => nextWibSlotLocalInput(19, 30));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void api.listExperiments().then((res) => {
      setExperiments(res.experiments);
      if (res.experiments.length > 0) {
        setSelectedExp(res.experiments[0].id);
      }
    });
  }, []);

  const handleGenerate = async () => {
    if (!selectedExp) {
      setNotice('Buat minimal 1 topik eksperimen dulu di tab Settings.');
      return;
    }
    setGenerating(true);
    setNotice(null);
    try {
      const res = await api.generateDrafts({
        experiment_id: selectedExp,
        hook_type: hookType,
        count,
        is_chain: isChain,
      });
      const defaultSlots = [
        nextWibSlotLocalInput(8, 30),
        nextWibSlotLocalInput(12, 30),
        nextWibSlotLocalInput(19, 30),
      ];
      setDrafts(
        res.drafts.map((d, idx) => ({
          key: `${Date.now()}-${idx}`,
          hook_type: d.hook_type,
          parts: d.parts,
          scheduledAtInput: defaultSlots[idx % defaultSlots.length],
        }))
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal generate AI');
    } finally {
      setGenerating(false);
    }
  };

  const updateDraftPart = (draftKey: string, partIdx: number, val: string) => {
    setDrafts((prev) =>
      prev.map((d) =>
        d.key === draftKey
          ? { ...d, parts: d.parts.map((p, i) => (i === partIdx ? val : p)) }
          : d
      )
    );
  };

  const commitDraft = async (
    draft: EditableDraft,
    mode: 'draft' | 'scheduled' | 'publish_now'
  ) => {
    setDrafts((prev) => prev.map((d) => (d.key === draft.key ? { ...d, saving: true } : d)));
    setNotice(null);
    try {
      const scheduledMs =
        mode === 'scheduled' && draft.scheduledAtInput
          ? new Date(draft.scheduledAtInput).getTime()
          : null;

      const created = await api.createPost({
        experiment_id: selectedExp || null,
        hook_type: draft.hook_type,
        parts: draft.parts,
        status: mode === 'scheduled' ? 'scheduled' : 'draft',
        scheduled_at: scheduledMs,
      });

      if (mode === 'publish_now') {
        await api.publishNow(created.post.id);
        setNotice('Post berhasil dipublish ke Threads!');
      } else if (mode === 'scheduled') {
        setNotice('Post masuk antrean jadwal.');
      } else {
        setNotice('Draft disimpan.');
      }

      setDrafts((prev) => prev.filter((d) => d.key !== draft.key));
      onSaved();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal menyimpan post');
      setDrafts((prev) => prev.map((d) => (d.key === draft.key ? { ...d, saving: false } : d)));
    }
  };

  const handleManualSave = async (mode: 'draft' | 'scheduled') => {
    if (!manualText.trim()) return;
    setNotice(null);
    try {
      await api.createPost({
        experiment_id: selectedExp || null,
        hook_type: hookType,
        parts: [manualText.trim()],
        status: mode,
        scheduled_at: mode === 'scheduled' ? new Date(manualSchedule).getTime() : null,
      });
      setManualText('');
      setNotice(mode === 'scheduled' ? 'Post manual dijadwalkan.' : 'Draft manual disimpan.');
      onSaved();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Gagal menyimpan post manual');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">AI Draft Studio</h2>
        <p className="font-mono-tech text-xs text-[var(--muted)]">
          Generate variasi hook per topik riset, edit seperlunya, lalu jadwalkan.
        </p>
      </div>

      {notice && (
        <div className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-2 text-xs font-bold">
          {notice}
        </div>
      )}

      {/* Generator Controls */}
      <div className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="font-mono-tech text-xs font-bold">
            Topik Eksperimen
            <select
              value={selectedExp}
              onChange={(e) => setSelectedExp(e.target.value)}
              className="mt-1 w-full border-2 border-[var(--ink)] bg-[var(--bg)] px-2.5 py-2 text-xs font-medium"
            >
              {experiments.length === 0 && <option value="">Belum ada topik</option>}
              {experiments.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.name}
                </option>
              ))}
            </select>
          </label>

          <label className="font-mono-tech text-xs font-bold">
            Tipe Hook
            <select
              value={hookType}
              onChange={(e) => setHookType(e.target.value as HookType)}
              className="mt-1 w-full border-2 border-[var(--ink)] bg-[var(--bg)] px-2.5 py-2 text-xs font-medium"
            >
              {Object.entries(HOOK_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="font-mono-tech text-xs font-bold">
            Jumlah Variasi
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-1 w-full border-2 border-[var(--ink)] bg-[var(--bg)] px-2.5 py-2 text-xs font-medium"
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} drafts
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col justify-between gap-2">
            <label className="font-mono-tech flex items-center gap-2 text-xs font-bold">
              <input
                type="checkbox"
                checked={isChain}
                onChange={(e) => setIsChain(e.target.checked)}
                className="h-4 w-4 accent-[var(--ink)]"
              />
              <span>Thread berantai (2–3 part)</span>
            </label>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !selectedExp}
              className="brutal-btn font-mono-tech inline-flex items-center justify-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-2 text-xs font-bold disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{generating ? 'Generating...' : 'Generate Hooks'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Generated Drafts */}
      {drafts.length > 0 && (
        <div className="space-y-3">
          <div className="font-mono-tech text-xs font-bold uppercase text-[var(--muted)]">
            Hasil Generate ({drafts.length})
          </div>
          {drafts.map((draft) => (
            <div
              key={draft.key}
              className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent-3)] px-2 py-0.5 text-[11px] font-bold">
                  {HOOK_LABELS[draft.hook_type]}
                </span>
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.filter((d) => d.key !== draft.key))}
                  className="font-mono-tech inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Buang</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {draft.parts.map((part, idx) => (
                  <div key={idx}>
                    <textarea
                      rows={3}
                      value={part}
                      onChange={(e) => updateDraftPart(draft.key, idx, e.target.value)}
                      className="w-full border-2 border-[var(--ink)] bg-[var(--bg)] p-2.5 text-sm focus:outline-none"
                    />
                    <div className="font-mono-tech mt-0.5 flex justify-between text-[10px] text-[var(--muted)]">
                      <span>Part {idx + 1}</span>
                      <span className={part.length > 500 ? 'font-bold text-red-600' : ''}>
                        {part.length}/500
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t-2 border-[var(--ink)]/20 pt-3">
                <input
                  type="datetime-local"
                  value={draft.scheduledAtInput}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev.map((d) =>
                        d.key === draft.key ? { ...d, scheduledAtInput: e.target.value } : d
                      )
                    )
                  }
                  className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--bg)] px-2 py-1 text-xs"
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={draft.saving}
                    onClick={() => commitDraft(draft, 'draft')}
                    className="brutal-btn font-mono-tech border-2 border-[var(--ink)] bg-[var(--bg)] px-2.5 py-1 text-xs font-bold"
                  >
                    Simpan Draft
                  </button>
                  <button
                    type="button"
                    disabled={draft.saving}
                    onClick={() => commitDraft(draft, 'scheduled')}
                    className="brutal-btn font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-2.5 py-1 text-xs font-bold"
                  >
                    Jadwalkan
                  </button>
                  <button
                    type="button"
                    disabled={draft.saving}
                    onClick={() => commitDraft(draft, 'publish_now')}
                    className="brutal-btn font-mono-tech inline-flex items-center gap-1 border-2 border-[var(--ink)] bg-[var(--accent-2)] px-2.5 py-1 text-xs font-bold"
                  >
                    <Send className="h-3 w-3" />
                    <span>Post Sekarang</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Manual Quick Post */}
      <div className="brutal-shadow border-2 border-[var(--ink)] bg-[var(--surface)] p-4">
        <div className="font-mono-tech mb-2 flex items-center gap-1.5 text-xs font-bold uppercase">
          <Plus className="h-3.5 w-3.5" />
          <span>Tulis Post Manual</span>
        </div>
        <textarea
          rows={3}
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder="Tulis hook/pertanyaan sendiri (maks 500 karakter)..."
          className="w-full border-2 border-[var(--ink)] bg-[var(--bg)] p-2.5 text-sm focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={manualSchedule}
              onChange={(e) => setManualSchedule(e.target.value)}
              className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--bg)] px-2 py-1 text-xs"
            />
            <span className="font-mono-tech text-[11px] text-[var(--muted)]">
              {manualText.length}/500
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleManualSave('draft')}
              className="brutal-btn font-mono-tech border-2 border-[var(--ink)] bg-[var(--bg)] px-3 py-1.5 text-xs font-bold"
            >
              Simpan Draft
            </button>
            <button
              type="button"
              onClick={() => handleManualSave('scheduled')}
              className="brutal-btn font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-3 py-1.5 text-xs font-bold"
            >
              Jadwalkan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
