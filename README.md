# kvk

KovaaK's 训练数据分析工具。把游戏在本机写出的逐局 stats 文件变成可以回看的成绩历史，并为某个基准测试档位安排每日训练计划。

纯前端、无后端、无账号。数据只在你自己的电脑和浏览器里。理由见 [ADR-0001](docs/adr/0001-no-backend-local-only.md)。

## 快速开始

```bash
npm install
npm run scan      # 扫一遍官方接口，建立 benchmark 目录（约 10 分钟，只需跑一次，之后可重复运行补增量）
npm run catalog   # 从 evxl.app 抽 benchmark 名字和两级分组（约 10 秒，可重复运行）
npm run dev       # 打开 http://localhost:5173
```

首次打开后，在「设置」页做两件事：

1. 选一次 KovaaK's 的 stats 目录：

   ```
   <Steam 库>/steamapps/common/FPSAimTrainer/FPSAimTrainer/stats
   ```

   选完就记住了。之后每次练完点一下「刷新」，只会解析新增的文件。

2. 选一次 `TopScores.sav`：

   ```
   %LOCALAPPDATA%\FPSAimTrainer\Saved\SaveGames\<steamid>\TopScores.sav
   ```

   里面是每个场景的个人最高分。stats 目录只留得住最近的那批逐局文件，不读这个的话，更早打过的场景会显示成 0 分。见 [ADR-0006](docs/adr/0006-topscores-pb-cache.md)。

**浏览器要求**：目录选择用的是 File System Access API，只有 Chrome / Edge 支持。其它浏览器请用设置页的「选择文件」退路。

## 页面

- **主页** — 今天（训练量进度与游戏时间、今天的计划、明天）、整个 benchmark 的分数段位表（高亮当前大组，每行可以 `▶` 直接进游戏、`add` 加进今天），下面接当天计划里的场景分数曲线，再下面是大组对比图
- **场景详情** — 单个场景的完整曲线和逐局明细，X 轴可切按局 / 按次训练 / 按天
- **日历** — 月视图，看训练量和计划，也可以往前排
- **设置** — stats 目录、TopScores.sav、当前 benchmark、目标等级、每日训练量、大组分组

## 推进规则

- 推进的单位是 **Category（大组）**：组内所有 Subcategory 都达到 Target Rank，这个组才算达标，才轮到下一个组。
- 每天从**候选池**（当前大组里还没达标的 Scenario）里自己挑 1-2 个练，系统只负责算池子。
- 每天有**两个互相独立的闸门**：Quota（当天总共打满多少局，默认 30，可改）只管当天进度；**过关只看当天最高分有没有够到 Target Rank**，和打了几局无关。
- 当天没过关，第二天的目标就不变；过关了就切到当前大组里还没达标的项目，整个大组都达标就切下一个大组。
- 计划会**自动往后排**：过关空出的位置按候选池的顺序补回来，没过关的原样留到明天。某一天只要有一条是你手动排的，那天之后就不再被自动重排。
- 可以提前排期。同一时间只有一份活跃计划，但可以整体切到另一个 benchmark。

详见 [ADR-0003](docs/adr/0003-progression-engine.md)、[ADR-0007](docs/adr/0007-auto-schedule.md)。

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建到 `dist/` |
| `npm run verify` | 拿真实 stats 目录 + 官方接口 + TopScores.sav 三方交叉验证 |
| `npm run smoke` | 端到端冒烟：真实数据 + 真实 benchmark 目录，打印推进引擎的输出 |
| `npm run check-schedule` | 自动排程规则的纯函数断言 |
| `npm run scan` | 扫 benchmarkId 区间，写 `public/benchmark-directory.json` |
| `npm run catalog` | 抽 evxl 的 benchmark 目录，写 `public/benchmark-catalog.json` |

`verify` 和 `smoke` 要读你本机的数据，仓库里**不留**任何默认路径，所以得自己传：

| 变量 | 必填 | 说明 |
|---|---|---|
| `STATS_DIR` | 是 | KovaaK's 的 stats 目录 |
| `PLAYER_STEAM_ID` | `verify` 必填 | 你的 SteamID64，拿去和官方排行榜对分 |
| `TOP_SCORES_PATH` | 否 | 不传就跳过存档那一条断言 |
| `BENCHMARK_ID` | 否 | 默认 686 |
| `TARGET_RANK` | 否 | 只有 `smoke` 用，默认 7 |

```bash
# bash / git-bash
STATS_DIR="D:/..." PLAYER_STEAM_ID=7656... TOP_SCORES_PATH="C:/..." npm run verify

# PowerShell
$env:STATS_DIR="D:/..."; $env:PLAYER_STEAM_ID="7656..."; npm run verify
```

## 数据来源

| 数据 | 来源 | 备注 |
|---|---|---|
| 每一局的分数、时长、设置 | 本地 `stats/*.csv` | 一个文件就是一局，文件名带时间戳 |
| 段位阈值、场景清单、段位名称与颜色 | 官方接口 | 用假 steamId 就能拿到任意 benchmark 的结构，不需要登录 |
| benchmark 编号 → ID 的映射 | 扫 ID 区间 | 官方没有列表接口，见 [ADR-0004](docs/adr/0004-benchmark-directory-by-id-scan.md) |
| benchmark 名字、大组 → 子类别的分组 | evxl.app 的前端 chunk | `npm run catalog` 抽出来，只当覆盖层，见 [ADR-0005](docs/adr/0005-catalog-overlay.md) |
| 历史最高分 | 本地 `TopScores.sav` | 补 stats 目录被清掉的那段，见 [ADR-0006](docs/adr/0006-topscores-pb-cache.md) |

## 别人设计的 benchmark

官方没有列表接口，也没有搜索，所以只有 ID 能认。设置页的「添加别人的 benchmark」可以直接粘 benchmarkId，
或者粘 evxl 的用户页链接（`https://evxl.app/u/<steamid>/Viscose%20Benchmarks/Easier`）——链接里是名字，
本地目录认得出来才换得出 ID，认不出就直接给 ID。

## 直接进游戏

每行场景名前面的 `▶`（以及场景详情页的「▶ 进游戏」）会用 Steam 把 KovaaK's 拉起来并直接进到那个场景：

```
steam://run/824270/?action=jump-to-scenario;name=<场景名>;mode=challenge
```

824270 是 KovaaK's 的 Steam appid，`jump-to-scenario` 是游戏自己认的指令，写法抄自 evxl.app。第一次点浏览器会问一次「是否允许打开 Steam」，允许之后就不再问。场景名按原样拼进去、不做转义（解码是游戏那侧的事），所以名字里带 `;` 的场景点不动——这是这套协议的边界。

## 三个必须知道的坑

1. **分数单位差 100 倍**。本地 stats 里的分数是游戏内显示值，官方接口的 `score` 是它的 100 倍，但同一个接口的 `rank_maxes` 用的是本地单位。直接比会静默失准。见 [ADR-0002](docs/adr/0002-score-unit-100x.md)。
2. **场景名只能精确匹配**。`Air Angelic 4 Voltaic Easy 80% (Good Version)` 和 `Air Angelic 4 Voltaic Easy` 是两个不同的场景，模糊匹配会把没打过的项目算成已完成。
3. **并发扫 ID 会被限流**，限流的响应容易被误判成「benchmark 不存在」而静默漏掉。扫描脚本已针对这点做了区分和重试。

## 文档

- [CONTEXT.md](CONTEXT.md) — 术语表，Run / Session / Category / Target Rank / Candidate Pool 等
- [docs/adr/](docs/adr/) — 架构决策记录
