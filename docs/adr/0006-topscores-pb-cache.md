# 个人最高分从 TopScores.sav 补，不只信 stats 目录

`stats` 目录只留得住还在盘上的那批逐局文件，更早的成绩会被清掉。于是会出现「某个场景本地一局都没有、但官方其实有分」：本项目实测 benchmark 686 的 `Air Angelic 4 Voltaic Easy 80% (Good Version)` 就是这样，本地三个相近场景都在（4028 / 5498 / 4149），唯独缺这一个，导致 `Fingertip` 整组显示成未定级、`Control Tracking` 卡住不动。

游戏另外写了一份**个人最高分缓存**：

```
%LOCALAPPDATA%\FPSAimTrainer\Saved\SaveGames\<steamid>\TopScores.sav
```

UE4 的 GVAS 格式，`LeaderboardsCacheSaveGame → TopScores`，每条记录是 `{ScenarioName: StrProperty, Score: FloatProperty, bIsAccuracyValue, AccuracyOrDamageEfficientcy, ScenarioHash}`。目录名里的 steamid 可能是**旧账号**（本机是 `76561194823311326`，当前账号是 `76561199118278622`），但文件确实在跟着当前会话更新，别被目录名骗了。

## 三条断言都过了

`npm run verify` 现在拿三个数据源互相校验：

- 断言 1、2：29 个可比对的场景，本地 PB × 100 == 官方 `score`，算出的段位 == 官方 `scenario_rank`。
- 断言 3：官方有分的 30 个场景，`TopScores.sav` 里的值全部一致（存档是本地单位，不乘 100）。
- 覆盖缺口：**官方有分、但逐局文件和存档都没有的场景，0 个。**

也就是说加上存档之后，本地对「你到过哪儿」的判断和官方完全一致。反过来 benchmark 686 的 `Reading` / `Precision` / `Linear` 全是 0 分是真的——那不是数据缺失，是这些场景确实没打过。

## 取舍

- **不解析 stats 目录之外的历史**，只读这一个缓存文件。它是游戏自己维护的，比我们猜靠谱。
- **浏览器读不到固定路径**，只能让用户用文件选择框选一次；解析结果按场景存进 IndexedDB，之后不必再选。
- **不写完整的 GVAS 解析器**，只按上面那个固定布局取数，并校验紧随其后的 `bIsAccuracyValue` 长度。对不上就抛错——宁可让用户看见「格式变了」，也不要静默塞进一堆 0 分。
- 分数按两位小数取整：float32 会带出 `95.0011978149414` 这种噪声，而游戏本身就只显示两位。
- 存档只用来定「历史最高分」。过关判定仍然是「**当天**最高分达到 Target Rank」（见 ADR-0003），两者不混。

## Considered Options

- **直接读官方接口拉玩家每个场景的 score** — 数据一样准，但要联网，而且换 benchmark 就得再拉一次。存档是本地的、一次读完、覆盖全部 benchmark，先用它。
- **接受「本地 CSV 才是真相」，缺的场景就显示「没打过」** — 会让候选池和进度长期失真：明明早就打过、分数够了的场景会一直挂在候选池里。
