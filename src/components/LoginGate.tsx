import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';

export function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="brutal-shadow w-full max-w-sm border-2 border-[var(--ink)] bg-[var(--surface)] p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-2.5 py-0.5 text-sm font-bold">
            threads.lab
          </span>
          <span className="font-mono-tech text-xs text-[var(--muted)]">personal</span>
        </div>

        <h1 className="text-xl font-bold tracking-tight">Masuk Dashboard</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Gunakan ADMIN_PASSWORD dari Wrangler secrets / .dev.vars.
        </p>

        <label className="font-mono-tech mt-5 block text-xs font-bold">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            className="mt-1.5 w-full border-2 border-[var(--ink)] bg-[var(--bg)] px-3 py-2 text-sm font-normal focus:outline-none"
          />
        </label>

        {error && (
          <p className="font-mono-tech mt-3 border-2 border-[var(--ink)] bg-[var(--accent-2)] px-2.5 py-1.5 text-xs font-bold text-[#121212]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="brutal-btn font-mono-tech mt-5 flex w-full items-center justify-center gap-2 border-2 border-[var(--ink)] bg-[var(--accent)] px-4 py-2.5 text-sm font-bold disabled:opacity-60"
        >
          <Lock className="h-4 w-4" strokeWidth={2.5} />
          <span>{loading ? 'Checking...' : 'Unlock'}</span>
        </button>
      </form>
    </div>
  );
}
