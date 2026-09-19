# kvk

KovaaK's 训练数据分析工具。把游戏在本机写出的逐局 stats 文件变成可以回看的成绩历史，并为某个基准测试档位安排每日训练计划。

## 成绩数据

**Run（一局）**:
KovaaK's 每次完成一个场景后写出的一个 stats 文件。本项目里最小的成绩事实单位，带精确到秒的时间戳。
_Avoid_: 记录、成绩、attempt

**Session（一次训练）**:
一串连续的 Run，与前后相邻 Run 的间隔至少 30 分钟。
_Avoid_: 场次、批次

**Day（训练日）**:
按本机时区切分的自然日。
_Avoid_: 天

## 基准测试结构

**Benchmark（基准测试档位）**:
一个（基准测试名称，难度）组合，例如 `Viscose Benchmarks / Easier`。在 KovaaK's 侧对应唯一的 kovaaksBenchmarkId；同一个名称的不同难度是彼此独立的 Benchmark。
_Avoid_: 基准、赛道

**Active Benchmark（活跃基准测试）**:
当前正在追的那一个 Benchmark。同一时间只有一份活跃计划，但可以整体切换到另一个 Benchmark——切换等于重新展开结构并另设 Target Rank，旧计划保留。
_Avoid_: 当前基准、主基准

**Category（类别）**:
Benchmark 内部最上层的分组，例如 `Control Tracking`。它是训练推进的单位：当它内部所有 Subcategory 都达标，才切换到下一个 Category。
_Avoid_: 大组、分类

**Subcategory（子类别）**:
Category 内部的下一级分组，例如 `Control Tracking` 下的 `Arm`。它带有 KovaaK's 官方计算的段位；段位达到 Target Rank 时该 Subcategory 达标。KovaaK's 官方 API 把这一级叫做 `category`，本项目统一称 Subcategory 以免与 Category 混淆。
_Avoid_: 分类、组

**Scenario（练习场景）**:
可以单独练习的一个项目，例如 `Flower Easier`。Run 挂在 Scenario 上，Scenario 属于且仅属于一个 Subcategory。
_Avoid_: 项目、地图、关卡

## 数据来源

**Catalog（benchmark 目录）**:
社区整理的 benchmark 名单：名字、缩写、难度，以及「Category → Subcategory」的分组结果，由 `npm run catalog` 从 evxl.app 抽到 `public/benchmark-catalog.json`。**只补名字和分组，不提供结构**——有哪些 Subcategory、有哪些 Scenario、阈值是多少，永远以官方 API 为准。
_Avoid_: 清单、索引

**Archive（最高分存档）**:
游戏自己维护的个人最高分缓存 `TopScores.sav`，每个场景一条。用来补 `stats` 目录被清掉的那段历史；没有它，很久以前打过的 Scenario 会被当成 0 分。见 docs/adr/0006-topscores-pb-cache.md
_Avoid_: 缓存、备份

**Stats 目录（逐局文件）**:
KovaaK's 写 Run 的地方。只保留还在盘上的那一批，更早的会被清掉——这正是需要 Archive 的原因。
_Avoid_: 日志目录

## 训练目标

**Target Rank（目标等级）**:
你为 Active Benchmark 设定的段位目标。达标与否，看官方算出的段位有没有够到它。
_Avoid_: 目标分、段位

**Candidate Pool（候选池）**:
当前 Category 中所有尚未达到 Target Rank 的 Scenario。你每天从这里挑 1-2 个作为当天的训练内容。
_Avoid_: 待练列表、任务池

**Quota（每日训练量）**:
你为一天设定的训练量目标，以局数计（默认 30 局，可改）。整天合计，不按计划条目分拆；只统计完整打完、有成绩的 Run。
_Avoid_: 任务量、上限

**Game Time（游戏时间）**:
每段训练从第一局开始算到最后一局结束的墙钟跨度，含中间没在打的间隔；间隔超过 Session 阈值（30 分钟）就算两段。它是「打开了多久游戏」的近似——stats 只记录每一局，在菜单里发呆的时间拿不到。
_Avoid_: 时长、在线时间

**Clear（过关）**:
某个 Scenario 在当天的最高分达到 Target Rank 的阈值。过关只由分数决定，与当天 Quota 是否练满无关。
_Avoid_: 达标、完成

**Auto-scheduled Entry（自动排期条目）**:
计划里标记为自动生成的条目：当天的结果出来后，由 `advancePlan()` 补进后面的日子，可以被重排覆盖。没有这个标记的是人工条目——一天里只要有一条人工条目，那天之后就不再自动重排。见 docs/adr/0007-auto-schedule.md
_Avoid_: 系统条目、自动任务

## 怎么看进度

**Rank Progress（段位进度）**:
雷达图每根轴上的值。整数部分是已达段位，小数部分是往下一段位走了多少（4.2 就是刚进第四段两成），顶到最高段位就是段位总数。
它不是「分数占最高等级阈值的百分比」——段位是同一个 Benchmark 内唯一共同的尺子，分数各场景差好几个数量级，换算成百分比也补不回来。见 docs/adr/0008-radar-compare.md
_Avoid_: 进度百分比、等级分

**Change（变化）**:
一条曲线第一个点到最后一个点的涨幅百分比，标在曲线标题旁边。跟着粒度走：按局比的是第一局和最后一局，按天比的是第一天和最近一天。只有一个点（没得比）时显示成 `—`。
_Avoid_: 涨跌幅、提升率


