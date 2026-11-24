import { LogOut } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type ThreadsStatus } from './lib/api';
import { LoginGate } from './components/LoginGate';
import { QueueTab } from './components/QueueTab';
import { ScoreboardTab } from './components/ScoreboardTab';
import { SettingsTab } from './components/SettingsTab';
import { StudioTab } from './components/StudioTab';

type Tab = 'scoreboard' | 'studio' | 'queue' | 'settings';

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [tab, setTab] = useState<Tab>('scoreboard');
  const [status, setStatus] = useState<ThreadsStatus | null>(null);
  const [queueSignal, setQueueSignal] = useState(0);

  const loadStatus = useCallback(async () => {
    try {
      const st = await api.threadsStatus();
      setStatus(st);
    } catch {
      // Ignore transient status fetch failure
    }
  }, []);

  useEffect(() => {
    void api
      .me()
      .then((res) => {
        setAuthenticated(res.authenticated);
        if (res.authenticated) {
          void loadStatus();
        }
      })
      .finally(() => setAuthChecked(true));
  }, [loadStatus]);

  if (!authChecked) {
    return (
      <div className="font-mono-tech flex min-h-screen items-center justify-center text-sm text-[var(--muted)]">
        Loading threads.lab...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginGate
        onSuccess={() => {
          setAuthenticated(true);
          void loadStatus();
        }}
      />
    );
  }

  const handleLogout = async () => {
    await api.logout();
    setAuthenticated(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b-2 border-[var(--ink)] bg-[var(--bg)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono-tech border-2 border-[var(--ink)] bg-[var(--accent)] px-2.5 py-1 text-sm font-bold">
              threads.lab
            </span>
            <span className="font-mono-tech hidden text-xs text-[var(--muted)] sm:inline">
              {status?.connected && status.account
                ? `@${status.account.username}`
                : 'Threads not connected'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {(
              [
                ['scoreboard', 'Scoreboard'],
                ['studio', 'AI Studio'],
                ['queue', 'Queue'],
                ['settings', 'Settings'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`font-mono-tech border-2 border-[var(--ink)] px-2.5 py-1 text-xs font-bold ${
                  tab === key
                    ? 'bg-[var(--ink)] text-[var(--surface)]'
                    : 'bg-[var(--surface)] text-[var(--ink)]'
                }`}
              >
                {label}
              </button>
            ))}

            <button
              type="button"
              onClick={handleLogout}
              aria-label="Logout"
              className="brutal-btn border-2 border-[var(--ink)] bg-[var(--surface)] p-1.5"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {tab === 'scoreboard' && <ScoreboardTab />}
        {tab === 'studio' && (
          <StudioTab
            onSaved={() => {
              setQueueSignal((s) => s + 1);
            }}
          />
        )}
        {tab === 'queue' && <QueueTab refreshSignal={queueSignal} />}
        {tab === 'settings' && <SettingsTab onStatusChange={() => void loadStatus()} />}
      </main>
    </div>
  );
}
