# benchmark 目录靠扫描 ID 区间建立

KovaaK's 官方**没有**公开的 benchmark 列表接口（试过 12 个候选路由，全部 404），也**不返回 benchmark 的名字**。但它对任意 benchmarkId 都返回完整结构，且不需要登录：

```
GET /webapp-backend/benchmarks/player-progress-rank-benchmark
      ?benchmarkId={id}&steamId=00000000000000000&page=0&max=100
```

返回 Category / Scenario 清单、每个 Scenario 的 `leaderboard_id` 与段位阈值 `rank_maxes`，以及 `ranks` 数组——段位名称、颜色、图标、playercard 都在里面，与 evxl catalog 里的完全一致。不存在的 ID 返回 `{"error":"Benchmark not found"}`，是个干净的判定信号。

因此：**扫一遍 ID 区间（1..3200）建立本地目录并缓存，不重复扫描。**上限取 3200 是因为社区目录里已知的最大 ID 是 2975（见 ADR-0005）；没有列表接口，就只能靠一个足够宽的区间兜住。

## 代价与后果

- 一次性约 2600 个请求，实测约 0.8 秒/个。必须限速并缓存，绝不能每次启动都扫。
- 目录里**没有 benchmark 名字**。名字要另外补（创作者表格、手工、或对着 kovaaks.com 页面抄）。
- 两级分组（`Control Tracking` = `Arm` + `Wrist` + `Fingertip` + `Blending`）**不在 API 里**。它很可能是 evxl 从创作者文档整理出的社区概念，而非 KovaaK's 官方概念。这部分自己维护。

## Considered Options

- **抄 evxl 的 catalog 当目录** — 能直接拿到名字和分组，但字段结构对不上（实测它的子类别会重名，`Speed` 与 `Speed Track` 撞车），也无法覆盖它没收录的 benchmark。**只把它当名字和分组的覆盖层单独用**，见 ADR-0005。
- **只硬编码用到的几个 benchmark** — 最省事，但需求明确要求能看到所有别人设计的 benchmark。
