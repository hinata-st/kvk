import { useEffect, useMemo, useState } from 'react';

import { useStore } from '../../app/store';

export function SettingsPage() {
  const {
    benchmarks,
    activeBenchmark,
    labelFor,
    settings,
    grouping,
    groupingFromCatalog,
    catalogMatch,
    importStatus,
    topScores,
    pickStatsFolder,
    importFiles,
    importTopScores,
    refresh,
    updateSettings,
    selectBenchmark,
    addBenchmark,
    saveGrouping,
    resetGrouping,
  } = useStore();

  const [groupDraft, setGroupDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [refInput, setRefInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    if (!activeBenchmark) {
      setGroupDraft({});
      return;
    }
    const draft: Record<string, string> = {};
    for (const sub of activeBenchmark.subcategories) {
      const group = grouping?.groups.find((g) => g.subcategories.includes(sub.name));
      draft[sub.name] = group?.name ?? sub.name;
    }
    setGroupDraft(draft);
  }, [activeBenchmark, grouping]);

  const sortedBenchmarks = useMemo(
    () => [...benchmarks].sort((a, b) => labelFor(a).localeCompare(labelFor(b), 'zh')),
    [benchmarks, labelFor],
  );

  /** 本地目录里有结构、但社区目录还没收名字的那些，界面上只能显示编号 */
  const unnamedCount = useMemo(
    () => benchmarks.filter((b) => labelFor(b).startsWith('#')).length,
    [benchmarks, labelFor],
  );

  /** 过滤后仍然要保住当前选中的那个，否则 select 会显示成空 */
  const visibleBenchmarks = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sortedBenchmarks;
    return sortedBenchmarks.filter(
      (b) =>
        b.benchmarkId === settings.activeBenchmarkId ||
        labelFor(b).toLowerCase().includes(needle) ||
        String(b.benchmarkId) === needle,
    );
  }, [sortedBenchmarks, filter, labelFor, settings.activeBenchmarkId]);

  const submitRef = async () => {
    setAddBusy(true);
    setAddError(null);
    try {
      setAddError(await addBenchmark(refInput));
      setRefInput('');
    } finally {
      setAddBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!activeBenchmark) return;
    const byName = new Map<string, string[]>();
    for (const [subcategory, groupName] of Object.entries(groupDraft)) {
      const name = groupName.trim() || subcategory;
      const list = byName.get(name);
      if (list) list.push(subcategory);
      else byName.set(name, [subcategory]);
    }
    // 按官方返回的顺序排，保证大组的先后与 benchmark 一致
    const order = activeBenchmark.subcategories.map((s) => s.name);
    const groups = [...byName.entries()]
      .map(([name, subcategories]) => ({
        name,
        subcategories: subcategories.sort((a, b) => order.indexOf(a) - order.indexOf(b)),
      }))
      .sort((a, b) => order.indexOf(a.subcategories[0]!) - order.indexOf(b.subcategories[0]!));
    await saveGrouping({ benchmarkId: activeBenchmark.benchmarkId, groups });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h2 className="text-lg font-semibold text-slate-100">逐局数据来源</h2>
        <p className="mt-1 text-sm text-slate-400">
          KovaaK's 写出的逐局 stats 文件目录，通常在
          <code className="mx-1 rounded bg-slate-900 px-1 py-0.5 text-xs">steamapps/common/FPSAimTrainer/FPSAimTrainer/stats</code>
          。选一次就记住了，之后点「刷新」只解析新增的文件。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white transition hover:bg-sky-500"
            onClick={() => void pickStatsFolder()}
          >
            选择 stats 目录
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700"
            onClick={() => void refresh()}
          >
            刷新
          </button>
          <label className="cursor-pointer rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700">
            选择文件
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void importFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
        </div>
        {importStatus.running && (
          <p className="mt-2 text-sm text-sky-400">
            正在导入 {importStatus.done} / {importStatus.total || '…'}
          </p>
        )}
        {importStatus.last && (
          <p className="mt-2 text-sm text-emerald-400">
            导入完成：新增 {importStatus.last.imported} 局，跳过 {importStatus.last.skipped} 个已导入文件
            {importStatus.last.failed > 0 && `，失败 ${importStatus.last.failed} 个`}
          </p>
        )}
        {importStatus.error && <p className="mt-2 text-sm text-rose-400">{importStatus.error}</p>}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h2 className="text-lg font-semibold text-slate-100">历史最高分存档</h2>
        <p className="mt-1 text-sm text-slate-400">
          游戏只把还在盘上的逐局文件留在 stats 目录里，更早的成绩会被清掉。所以本地算出来的最高分
          可能比你的真实水平低。<code className="mx-1 rounded bg-slate-900 px-1 py-0.5 text-xs">TopScores.sav</code>
          里存着每个场景的个人最高分，读一次就补上这段。通常在
          <code className="mx-1 rounded bg-slate-900 px-1 py-0.5 text-xs">
            %LOCALAPPDATA%/FPSAimTrainer/Saved/SaveGames/&lt;steamid&gt;/
          </code>
          。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded bg-sky-600 px-3 py-1.5 text-sm text-white transition hover:bg-sky-500">
            选择 TopScores.sav
            <input
              type="file"
              accept=".sav"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importTopScores(file);
                event.target.value = '';
              }}
            />
          </label>
          {topScores.scores.size > 0 && (
            <span className="text-sm text-emerald-400">
              已读入 {topScores.scores.size} 个场景的最高分
              {topScores.importedAt && `（${topScores.importedAt.slice(0, 10)}）`}
            </span>
          )}
          {topScores.scores.size === 0 && !topScores.error && (
            <span className="text-sm text-slate-500">还没读入。不读也能用，就是那些老成绩会显示成 0 分。</span>
          )}
        </div>
        {topScores.error && <p className="mt-2 text-sm text-rose-400">{topScores.error}</p>}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h2 className="text-lg font-semibold text-slate-100">训练目标</h2>

        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">
              当前 benchmark（共 {benchmarks.length} 个，{benchmarks.length - unnamedCount} 个有名字）
            </span>
            <input
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
              placeholder="按名字或编号过滤"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <select
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={settings.activeBenchmarkId ?? ''}
              onChange={(event) =>
                void selectBenchmark(event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">（未选择）</option>
              {visibleBenchmarks.map((b) => (
                <option key={b.benchmarkId} value={b.benchmarkId}>
                  {labelFor(b)}
                </option>
              ))}
            </select>
            {filter.trim() !== '' && (
              <span className="text-xs text-slate-500">
                匹配 {visibleBenchmarks.length} 个
              </span>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">目标等级</span>
            <select
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={settings.targetRank}
              onChange={(event) => void updateSettings({ targetRank: Number(event.target.value) })}
            >
              {(activeBenchmark?.ranks ?? []).slice(1).map((rank, index) => (
                <option key={rank.name + index} value={index + 1}>
                  {index + 1}. {rank.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">每日训练量（局）</span>
            <input
              type="number"
              min={1}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={settings.quotaRuns}
              onChange={(event) => void updateSettings({ quotaRuns: Number(event.target.value) || 1 })}
            />
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-sky-500"
              checked={settings.autoAdvance}
              onChange={(event) => void updateSettings({ autoAdvance: event.target.checked })}
            />
            <span className="text-slate-400">
              自动往后排
              <span className="mt-0.5 block text-xs text-slate-500">
                每天结束把过了关的场景换掉、没过的留到明天，再从候选池补新的。
                你手动排过的那一天不会被覆盖。
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h2 className="text-lg font-semibold text-slate-100">添加别人的 benchmark</h2>
        <p className="mt-1 text-sm text-slate-400">
          KovaaK's 官方没有「列出所有 benchmark」的接口，一个 benchmark 只能按 ID 认。所以别人设计的
          benchmark，只要有 ID 就能拉进来；粘 evxl 的用户页链接也行（它里面是名字，本地目录认得出来才换得出 ID）。
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRef();
          }}
        >
          <input
            className="min-w-72 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
            placeholder="686，或 https://evxl.app/u/<steamid>/Viscose Benchmarks/Easier"
            value={refInput}
            onChange={(event) => setRefInput(event.target.value)}
          />
          <button
            type="submit"
            disabled={addBusy || refInput.trim() === ''}
            className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white transition hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500"
          >
            {addBusy ? '拉取中…' : '拉取并启用'}
          </button>
        </form>
        {addError && <p className="mt-2 text-sm text-rose-400">{addError}</p>}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h2 className="text-lg font-semibold text-slate-100">大组分组</h2>
        <p className="mt-1 text-sm text-slate-400">
          KovaaK's 官方只有平铺的子类别，没有「大组」这个概念（见 ADR-0004）。把子类别填成同一个名字就会合成一个大组。
        </p>
        {!activeBenchmark ? (
          <p className="mt-3 text-sm text-slate-500">先选一个 benchmark。</p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              {catalogMatch?.grouping ? (
                groupingFromCatalog ? (
                  <span className="text-emerald-400">目录里有这个 benchmark 的分组，已经自动填好。</span>
                ) : (
                  <span className="text-amber-400">你改过分组，目录里的那套被覆盖了。</span>
                )
              ) : (
                <span className="text-slate-500">
                  目录里没有（或对不上）这个 benchmark 的分组，下面的名字是官方子类别名，自己填吧。
                </span>
              )}
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {activeBenchmark.subcategories.map((sub) => (
                <label key={sub.name} className="flex items-center gap-2 text-sm">
                  <span className="w-36 shrink-0 truncate text-slate-400">
                    {catalogMatch?.subcategoryNames.get(sub.name) ?? sub.name}
                  </span>
                  <input
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
                    value={groupDraft[sub.name] ?? ''}
                    onChange={(event) =>
                      setGroupDraft((prev) => ({ ...prev, [sub.name]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white transition hover:bg-sky-500"
                onClick={() => void saveDraft()}
              >
                保存分组
              </button>
              {!groupingFromCatalog && (
                <button
                  type="button"
                  className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700"
                  onClick={() => void resetGrouping()}
                >
                  恢复目录分组
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
