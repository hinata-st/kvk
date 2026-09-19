import { useMemo, useState } from 'react';

import { dayKey } from '../../core/aggregate';
import { useStore } from '../../app/store';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function monthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  // 让网格从周一开始
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function CalendarPage({ onOpenScenario }: { onOpenScenario: (scenario: string) => void }) {
  const { runs, settings, plan, activeBenchmark, progression, subcategoryLabel, addPlanEntry, removePlanEntry } =
    useStore();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [picked, setPicked] = useState('');

  const runsPerDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const run of runs) {
      const key = dayKey(run.startedAt);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [runs]);

  const planPerDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of plan) {
      const list = map.get(entry.day);
      if (list) list.push(entry.scenario);
      else map.set(entry.day, [entry.scenario]);
    }
    return map;
  }, [plan]);

  /** 按大组 -> 子类别摊平，排计划时能找到场景属于哪儿 */
  const allScenarios = useMemo(
    () =>
      (progression?.categories ?? []).flatMap((category) =>
        category.subcategories.flatMap((sub) =>
          sub.scenarios.map((s) => ({ name: s.scenario, category: category.name, sub: sub.name })),
        ),
      ),
    [progression],
  );

  const cells = monthDays(cursor.getFullYear(), cursor.getMonth());
  const selectedEntries = plan.filter((p) => p.day === selected);
  const selectedRuns = runsPerDay.get(selected) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">
          {cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月
        </h2>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-sm text-slate-300 hover:bg-slate-700"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            上月
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-1 text-sm text-slate-300 hover:bg-slate-700"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            下月
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day) => {
            const key = dayKey(day);
            const count = runsPerDay.get(key) ?? 0;
            const entries = planPerDay.get(key) ?? [];
            const inMonth = day.getMonth() === cursor.getMonth();
            const met = settings.quotaRuns > 0 && count >= settings.quotaRuns;
            const isToday = key === dayKey(new Date());
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className={`flex h-20 flex-col items-start gap-1 rounded border p-1.5 text-left transition ${
                  selected === key ? 'border-sky-500 bg-sky-500/10' : 'border-slate-700/70 hover:bg-slate-700/30'
                } ${inMonth ? '' : 'opacity-40'}`}
              >
                <span className={`text-xs ${isToday ? 'font-bold text-sky-400' : 'text-slate-400'}`}>
                  {day.getDate()}
                </span>
                {count > 0 && (
                  <span className={`text-xs ${met ? 'text-emerald-400' : 'text-slate-300'}`}>{count} 局</span>
                )}
                {entries.length > 0 && <span className="text-xs text-amber-400">{entries.length} 个计划</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium text-slate-100">{selected}</h3>
          <span className="text-sm text-slate-400">
            {selectedRuns} / {settings.quotaRuns} 局
          </span>
        </div>

        <ul className="mt-3 flex flex-col gap-2">
          {selectedEntries.length === 0 && <li className="text-sm text-slate-500">这一天还没有排计划。</li>}
          {selectedEntries.map((entry) => (
            <li
              key={entry.scenario}
              className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/40 px-3 py-2 text-sm"
            >
              <button
                type="button"
                className="flex-1 truncate text-left text-slate-100 hover:text-sky-400"
                onClick={() => onOpenScenario(entry.scenario)}
              >
                {entry.scenario}
              </button>
              {entry.auto === true && (
                <span className="shrink-0 rounded bg-slate-700/70 px-1 text-[10px] text-slate-400">自动</span>
              )}
              <span className="shrink-0 text-xs text-slate-500">{subcategoryLabel(entry.subcategory)}</span>
              <button
                type="button"
                className="shrink-0 text-xs text-slate-500 hover:text-rose-400"
                onClick={() => void removePlanEntry(entry.day, entry.scenario)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>

        {activeBenchmark ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <select
              className="min-w-64 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
            >
              <option value="">选一个场景排到这一天…</option>
              {(progression?.categories ?? []).map((category) => (
                <optgroup key={category.name} label={category.name}>
                  {allScenarios
                    .filter((s) => s.category === category.name)
                    .map((s) => (
                      <option key={s.name} value={s.name}>
                        {subcategoryLabel(s.sub)} · {s.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              disabled={!picked}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white transition hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500"
              onClick={() => {
                const target = allScenarios.find((s) => s.name === picked);
                if (!target) return;
                void addPlanEntry({
                  day: selected,
                  benchmarkId: activeBenchmark.benchmarkId,
                  category: target.category,
                  subcategory: target.sub,
                  scenario: target.name,
                });
                setPicked('');
              }}
            >
              添加
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">先在设置页选一个 benchmark。</p>
        )}
      </div>
    </div>
  );
}
