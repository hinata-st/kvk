import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  benchmarkLabel,
  catalogIndex,
  matchCatalog,
  type CatalogEntry,
  type CatalogFile,
  type CatalogMatch,
} from '../core/catalog';
import { bestByDay, dayKey } from '../core/aggregate';
import { computeProgression, type CategoryGrouping, type Progression } from '../core/plan';
import { advancePlan, type PlanScenario } from '../core/schedule';
import { DEFAULT_SETTINGS, type PlanEntry, type Settings } from '../core/settings';
import type { BenchmarkSnapshot, Run } from '../core/types';
import { findEntryByName, parseBenchmarkRef } from '../data/benchmarkRef';
import { fetchBenchmarkOutcome } from '../data/kovaaksApi';
import { seedGroupingFor } from '../data/seedGroups';
import { parseTopScores } from '../core/parseTopScores';
import * as db from '../storage/db';
import { importFromDirectoryHandle, importFromFileList, type ImportResult } from './importStats';

export interface ImportStatus {
  running: boolean;
  done: number;
  total: number;
  last: ImportResult | null;
  error: string | null;
}

/**
 * TopScores.sav 读出来的个人最高分缓存。
 *
 * 它存在的理由：stats 目录只留得住还在盘上的那批逐局文件，更早的成绩会被清掉。
 * 只信本地文件的话，那些场景会显示成 0 分，候选池和进度跟着失真。
 * 见 docs/adr/0006-topscores-pb-cache.md
 */
export interface TopScoresState {
  importedAt: string | null;
  fileName: string | null;
  scores: Map<string, number>;
  error: string | null;
}

const EMPTY_TOP_SCORES: TopScoresState = { importedAt: null, fileName: null, scores: new Map(), error: null };

interface Store {
  ready: boolean;
  runs: Run[];
  /** 场景名 -> 历史最高分（本地单位） */
  bestByScenario: Map<string, number>;
  /** 只有逐局文件里算得出来的那份最高分，用来和存档 PB 区分 */
  localBestByScenario: Map<string, number>;
  topScores: TopScoresState;
  importTopScores: (file: File) => Promise<void>;
  benchmarks: BenchmarkSnapshot[];
  /** benchmarkId -> 社区目录条目（名字 + 分组）。只有被 evxl 收录的那部分有。 */
  catalog: Map<number, CatalogEntry>;
  /** 当前活跃 benchmark 在目录里对上的结果；没对上就是 null */
  catalogMatch: CatalogMatch | null;
  settings: Settings;
  grouping: CategoryGrouping | null;
  /** 当前分组是不是直接来自目录（而不是你手改过的） */
  groupingFromCatalog: boolean;
  plan: PlanEntry[];
  progression: Progression | null;
  activeBenchmark: BenchmarkSnapshot | null;
  importStatus: ImportStatus;

  pickStatsFolder: () => Promise<void>;
  importFiles: (files: FileList | File[]) => Promise<void>;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  selectBenchmark: (benchmarkId: number | null) => Promise<void>;
  /** 拉一个 benchmark 进本地目录。返回错误信息，成功则返回 null。 */
  addBenchmark: (input: string) => Promise<string | null>;
  saveGrouping: (grouping: CategoryGrouping) => Promise<void>;
  resetGrouping: () => Promise<void>;
  labelFor: (snapshot: BenchmarkSnapshot) => string;
  /** 官方子类别名 -> 显示名。目录里有就让目录的写法顶上去，比如 `Speed Track` -> `Speed`。 */
  subcategoryLabel: (name: string) => string;
  addPlanEntry: (entry: Omit<PlanEntry, 'createdAt'>) => Promise<void>;
  removePlanEntry: (day: string, scenario: string) => Promise<void>;
  /** 按过关情况把日程往后推一天。平时是自动跑的，这个给「重算一次」用。 */
  advanceSchedule: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore 必须在 StoreProvider 内使用');
  return store;
}

const DIRECTORY_URL = `${import.meta.env.BASE_URL}benchmark-directory.json`;
const CATALOG_URL = `${import.meta.env.BASE_URL}benchmark-catalog.json`;

async function loadBenchmarkDirectory(): Promise<BenchmarkSnapshot[]> {
  try {
    const res = await fetch(DIRECTORY_URL);
    if (!res.ok) return [];
    const json = (await res.json()) as { benchmarks?: Record<string, BenchmarkSnapshot> };
    return Object.values(json.benchmarks ?? {});
  } catch {
    return [];
  }
}

async function loadCatalog(): Promise<CatalogEntry[]> {
  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) return [];
    const json = (await res.json()) as CatalogFile;
    return json.benchmarks ?? [];
  } catch {
    return [];
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [topScores, setTopScores] = useState<TopScoresState>(EMPTY_TOP_SCORES);
  const [benchmarks, setBenchmarks] = useState<BenchmarkSnapshot[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  /** 你在设置页手改过的分组。null 表示还没改过，用目录或种子的 */
  const [groupingDraft, setGroupingDraft] = useState<CategoryGrouping | null>(null);
  const [plan, setPlan] = useState<PlanEntry[]>([]);
  const [importStatus, setImportStatus] = useState<ImportStatus>({
    running: false,
    done: 0,
    total: 0,
    last: null,
    error: null,
  });

  const reloadRuns = useCallback(async () => {
    setRuns(await db.getAllRuns());
  }, []);

  const reloadPlan = useCallback(async () => {
    setPlan(await db.getAllPlanEntries());
  }, []);

  /** 把静态目录导进 IndexedDB；已有则跳过。 */
  const syncBenchmarkDirectory = useCallback(async () => {
    const cached = await db.getAllBenchmarks();
    if (cached.length > 0) {
      setBenchmarks(cached);
      return;
    }
    const fromFile = await loadBenchmarkDirectory();
    if (fromFile.length > 0) {
      await db.putBenchmarks(fromFile);
      setBenchmarks(fromFile);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [loadedSettings, loadedBenchmarks, loadedCatalog, loadedPlan, loadedRuns, storedTopScores] =
        await Promise.all([
        db.getSettings(),
        db.getAllBenchmarks(),
        loadCatalog(),
        db.getAllPlanEntries(),
        db.getAllRuns(),
        db.getTopScores(),
      ]);
      setSettings(loadedSettings);
      setBenchmarks(loadedBenchmarks);
      setCatalog(loadedCatalog);
      setPlan(loadedPlan);
      setRuns(loadedRuns);
      if (storedTopScores) {
        setTopScores({
          importedAt: storedTopScores.importedAt,
          fileName: storedTopScores.fileName,
          scores: new Map(Object.entries(storedTopScores.scores)),
          error: null,
        });
      }
      setReady(true);
      if (loadedBenchmarks.length === 0) await syncBenchmarkDirectory();
      if (loadedRuns.length === 0) await reloadRuns();
    })();
  }, [syncBenchmarkDirectory, reloadRuns]);

  // 换 benchmark 时把分组也换掉：你手改过的 > 目录里的 > 种子，都没有就各自成组
  const activeBenchmarkId = settings.activeBenchmarkId;
  useEffect(() => {
    if (activeBenchmarkId === null) return;
    void (async () => {
      const stored = await db.getGrouping(activeBenchmarkId);
      setGroupingDraft(stored);
    })();
  }, [activeBenchmarkId]);

  const localBestByScenario = useMemo(() => {
    const map = new Map<string, number>();
    for (const run of runs) {
      const current = map.get(run.scenario);
      if (current === undefined || run.score > current) map.set(run.scenario, run.score);
    }
    return map;
  }, [runs]);

  /** 逐局文件和存档 PB 取大的那个：过关判定看的是「你到过哪儿」，不是「盘上还剩几局」。 */
  const bestByScenario = useMemo(() => {
    if (topScores.scores.size === 0) return localBestByScenario;
    const map = new Map(topScores.scores);
    for (const [scenario, score] of localBestByScenario) {
      if ((map.get(scenario) ?? 0) < score) map.set(scenario, score);
    }
    return map;
  }, [localBestByScenario, topScores]);

  const activeBenchmark = useMemo(
    () => benchmarks.find((b) => b.benchmarkId === activeBenchmarkId) ?? null,
    [benchmarks, activeBenchmarkId],
  );

  const catalogById = useMemo(() => catalogIndex(catalog), [catalog]);

  const catalogMatch = useMemo(() => {
    if (!activeBenchmark) return null;
    return matchCatalog(activeBenchmark, catalogById.get(activeBenchmark.benchmarkId));
  }, [activeBenchmark, catalogById]);

  const groupingFromCatalog = groupingDraft === null && catalogMatch?.grouping != null;

  const grouping = useMemo(() => {
    if (activeBenchmarkId === null) return null;
    return groupingDraft ?? catalogMatch?.grouping ?? seedGroupingFor(activeBenchmarkId);
  }, [activeBenchmarkId, groupingDraft, catalogMatch]);

  const labelFor = useCallback(
    (snapshot: BenchmarkSnapshot) => benchmarkLabel(snapshot, catalogById.get(snapshot.benchmarkId)),
    [catalogById],
  );

  const subcategoryLabel = useCallback(
    (name: string) => catalogMatch?.subcategoryNames.get(name) ?? name,
    [catalogMatch],
  );

  const progression = useMemo(() => {
    if (!activeBenchmark) return null;
    return computeProgression(activeBenchmark, grouping, bestByScenario, settings.targetRank);
  }, [activeBenchmark, grouping, bestByScenario, settings.targetRank]);

  /** 场景 -> Target Rank 的阈值。过关判定用的就是它 */
  const thresholdOf = useMemo(() => {
    const map = new Map<string, number>();
    if (activeBenchmark) {
      for (const sub of activeBenchmark.subcategories) {
        for (const scenario of sub.scenarios) {
          const threshold = scenario.rankMaxes[settings.targetRank - 1];
          if (threshold !== undefined) map.set(scenario.name, threshold);
        }
      }
    }
    return (scenario: string) => map.get(scenario);
  }, [activeBenchmark, settings.targetRank]);

  /**
   * 按过关情况把日程往后推。
   *
   * 靠「生成结果和已有的一样就不写库」来收敛：写了会触发重读计划、重算一遍，
   * 第二次算出同样的结果就停住，不会来回抖。见 docs/adr/0007-auto-schedule.md
   */
  const advanceSchedule = useCallback(async () => {
    if (!settings.autoAdvance || !activeBenchmark || !progression) return;
    const pool: PlanScenario[] = progression.candidates.map((candidate) => ({
      scenario: candidate.scenario,
      category: progression.current?.name ?? candidate.subcategory,
      subcategory: candidate.subcategory,
    }));
    const { generated } = advancePlan({
      plan,
      bestOfDay: bestByDay(runs),
      pool,
      thresholdOf,
      today: dayKey(new Date()),
    });

    let wrote = false;
    for (const [day, entries] of generated) {
      const before = plan.filter((entry) => entry.day === day && entry.auto === true);
      const unchanged =
        before.length === entries.length &&
        before.every((entry) => entries.some((e) => e.scenario === entry.scenario));
      if (unchanged) continue;
      const createdAt = new Date().toISOString();
      await db.replaceAutoPlanEntries(
        day,
        entries.map((entry) => ({
          ...entry,
          day,
          benchmarkId: activeBenchmark.benchmarkId,
          auto: true,
          createdAt,
        })),
      );
      wrote = true;
    }
    if (wrote) await reloadPlan();
  }, [settings.autoAdvance, activeBenchmark, progression, plan, runs, thresholdOf, reloadPlan]);

  // 每次打开、每次导入完数据之后都重算一遍。收敛条件见上面。
  useEffect(() => {
    void advanceSchedule();
  }, [advanceSchedule]);

  const runImport = useCallback(
    async (task: (report: (done: number, total: number) => void) => Promise<ImportResult>) => {
      setImportStatus({ running: true, done: 0, total: 0, last: null, error: null });
      try {
        const result = await task((done, total) =>
          setImportStatus((prev) => ({ ...prev, done, total })),
        );
        await reloadRuns();
        setImportStatus({ running: false, done: result.scanned, total: result.scanned, last: result, error: null });
      } catch (error) {
        setImportStatus({
          running: false,
          done: 0,
          total: 0,
          last: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [reloadRuns],
  );

  const pickStatsFolder = useCallback(async () => {
    const picker = (window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    if (!picker) {
      setImportStatus({
        running: false,
        done: 0,
        total: 0,
        last: null,
        error: '这个浏览器不支持目录选择，请用 Chrome 或 Edge，或改用「选择文件」',
      });
      return;
    }
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker();
    } catch {
      return; // 用户取消了
    }
    await db.saveStatsDirHandle(handle);
    await runImport((report) => importFromDirectoryHandle(handle, report));
  }, [runImport]);

  const refresh = useCallback(async () => {
    const handle = await db.getStatsDirHandle();
    if (!handle) {
      setImportStatus({
        running: false,
        done: 0,
        total: 0,
        last: null,
        error: '还没选过 stats 目录',
      });
      return;
    }
    const permission = await (handle as unknown as {
      queryPermission?(d: { mode: string }): Promise<PermissionState>;
    }).queryPermission?.({ mode: 'read' });
    if (permission && permission !== 'granted') {
      const request = await (handle as unknown as {
        requestPermission?(d: { mode: string }): Promise<PermissionState>;
      }).requestPermission?.({ mode: 'read' });
      if (request !== 'granted') return;
    }
    await runImport((report) => importFromDirectoryHandle(handle, report));
  }, [runImport]);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      await runImport((report) => importFromFileList(Array.from(files), report));
    },
    [runImport],
  );

  /** 读一次 TopScores.sav，把个人最高分缓存记下来。之后不需要重复读。 */
  const importTopScores = useCallback(async (file: File) => {
    try {
      const entries = parseTopScores(await file.arrayBuffer());
      const scores: Record<string, number> = {};
      for (const entry of entries) {
        const current = scores[entry.scenario];
        if (current === undefined || entry.score > current) scores[entry.scenario] = entry.score;
      }
      const stored = { importedAt: new Date().toISOString(), fileName: file.name, scores };
      await db.saveTopScores(stored);
      setTopScores({
        importedAt: stored.importedAt,
        fileName: stored.fileName,
        scores: new Map(Object.entries(scores)),
        error: null,
      });
    } catch (error) {
      setTopScores((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...(await db.getSettings()), ...patch };
    await db.saveSettings(next);
    setSettings(next);
  }, []);

  const selectBenchmark = useCallback(
    async (benchmarkId: number | null) => {
      await updateSettings({ activeBenchmarkId: benchmarkId });
    },
    [updateSettings],
  );

  /**
   * 把别人设计的 benchmark 拉进来。
   *
   * 官方没有列表接口，所以只能靠 ID 或名字。名字那条路要过本地目录：
   * 目录里有别人分享链接里的那个名字，才换得出 ID。见 docs/adr/0005。
   */
  const addBenchmark = useCallback(
    async (input: string) => {
      const ref = parseBenchmarkRef(input);
      if (ref.kind === 'invalid') return ref.reason;

      let benchmarkId: number;
      if (ref.kind === 'name') {
        const entry = findEntryByName(catalog, ref.benchmarkName, ref.difficultyName);
        if (!entry) {
          return `目录里没有「${ref.benchmarkName} / ${ref.difficultyName}」。直接给 benchmarkId 吧。`;
        }
        benchmarkId = entry.benchmarkId;
      } else {
        benchmarkId = ref.benchmarkId;
      }

      const outcome = await fetchBenchmarkOutcome(benchmarkId);
      if (outcome.status === 'missing') return `官方那边没有 #${benchmarkId} 这个 benchmark。`;
      if (outcome.status === 'error') return `拉 #${benchmarkId} 失败：${outcome.detail}（再试一次）`;

      await db.putBenchmarks([outcome.snapshot]);
      const next = [...(await db.getAllBenchmarks())];
      setBenchmarks(next);
      await updateSettings({ activeBenchmarkId: benchmarkId });
      return null;
    },
    [catalog, updateSettings],
  );

  const saveGrouping = useCallback(async (next: CategoryGrouping) => {
    await db.putGrouping(next);
    setGroupingDraft(next);
  }, []);

  const resetGrouping = useCallback(async () => {
    if (activeBenchmarkId !== null) await db.deleteGrouping(activeBenchmarkId);
    setGroupingDraft(null);
  }, [activeBenchmarkId]);

  const addPlanEntry = useCallback(
    async (entry: Omit<PlanEntry, 'createdAt'>) => {
      await db.putPlanEntry({ ...entry, createdAt: new Date().toISOString() });
      await reloadPlan();
    },
    [reloadPlan],
  );

  const removePlanEntry = useCallback(
    async (day: string, scenario: string) => {
      await db.deletePlanEntry(day, scenario);
      await reloadPlan();
    },
    [reloadPlan],
  );

  const value: Store = {
    ready,
    runs,
    bestByScenario,
    localBestByScenario,
    topScores,
    importTopScores,
    benchmarks,
    catalog: catalogById,
    catalogMatch,
    settings,
    grouping,
    groupingFromCatalog,
    plan,
    progression,
    activeBenchmark,
    importStatus,
    pickStatsFolder,
    importFiles,
    refresh,
    updateSettings,
    selectBenchmark,
    addBenchmark,
    saveGrouping,
    resetGrouping,
    labelFor,
    subcategoryLabel,
    addPlanEntry,
    removePlanEntry,
    advanceSchedule,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
