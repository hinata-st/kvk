import { useEffect, useState } from 'react';

import { StoreProvider, useStore } from './app/store';
import { CalendarPage } from './ui/pages/CalendarPage';
import { HomePage } from './ui/pages/HomePage';
import { ScenarioPage } from './ui/pages/ScenarioPage';
import { SettingsPage } from './ui/pages/SettingsPage';

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

const NAV = [
  { href: '#/', label: '主页' },
  { href: '#/calendar', label: '日历' },
  { href: '#/settings', label: '设置' },
];

function Shell() {
  const route = useHashRoute();
  const { ready, runs, activeBenchmark, labelFor, importStatus, refresh, pickStatsFolder } = useStore();

  const openScenario = (scenario: string) => {
    window.location.hash = `#/scenario/${encodeURIComponent(scenario)}`;
  };

  if (!ready) {
    return <div className="p-8 text-slate-400">正在载入…</div>;
  }

  let page: React.ReactNode;
  if (route.startsWith('/scenario/')) {
    page = <ScenarioPage scenario={decodeURIComponent(route.slice('/scenario/'.length))} />;
  } else if (route === '/calendar') {
    page = <CalendarPage onOpenScenario={openScenario} />;
  } else if (route === '/settings') {
    page = <SettingsPage />;
  } else {
    page = <HomePage onOpenScenario={openScenario} />;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200">
      <header className="border-b border-slate-700/70 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-3">
          <span className="font-semibold tracking-tight text-slate-100">kvk</span>
          <nav className="flex gap-1">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`rounded px-2.5 py-1 text-sm transition ${
                  route === item.href.slice(1)
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-400">
            <span>
              {runs.length} 局
              {activeBenchmark && ` · ${labelFor(activeBenchmark)}`}
            </span>
            {importStatus.running ? (
              <span className="text-sky-400">
                导入中 {importStatus.done}/{importStatus.total || '…'}
              </span>
            ) : (
              <button
                type="button"
                className="rounded border border-slate-600 px-2 py-1 text-xs transition hover:bg-slate-700"
                onClick={() => void refresh()}
              >
                刷新
              </button>
            )}
          </div>
        </div>
      </header>

      {runs.length === 0 && (
        <div className="mx-auto max-w-6xl px-5 pt-5">
          <div className="rounded-lg border border-amber-600/50 bg-amber-500/10 p-4 text-sm">
            <p className="text-amber-300">还没有导入任何数据。</p>
            <p className="mt-1 text-slate-300">
              选一次 KovaaK's 的 stats 目录，之后点「刷新」只会解析新增的文件。
            </p>
            <button
              type="button"
              className="mt-3 rounded bg-sky-600 px-3 py-1.5 text-white transition hover:bg-sky-500"
              onClick={() => void pickStatsFolder()}
            >
              选择 stats 目录
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-5 py-6">{page}</main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
