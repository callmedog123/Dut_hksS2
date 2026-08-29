# 数据契约

The Unclicked 当前唯一共享契约版本是 `SCHEMA_VERSION = 2`。领域校验在 `shared/types.js`，Chrome 消息信封和 payload 校验在 `shared/messages.js`，持久化二次校验与 v1→v2 迁移在 `storage/repository.js`。原有领域 DTO 仍保留 `V1` 名称和字段；标签以独立 TagProfile DTO 表达，不改变 `CandidateV1`、消息 payload 或当前 Repository 记录。

## 领域对象

| 对象 | 保存的最小字段 | 生命周期/用途 |
| --- | --- | --- |
| `CandidateV1` | `id`、规范化 `url`、`title`、`source`、`rank`、`sessionId`、成对可选 `contentType`/`layoutType` | Adapter 输出；不含 Element |
| `SearchContextV1` | `query`、`source`、`timestamp`、可选 `keywords` | 会话与重逢的最小情境 |
| `ContextTagProfileV1` | `sessionId`、稳定排序的 `normalizedTags` | 由搜索词本地提取；任务 8 起按 Session Owner 持久化 |
| `CandidateTagProfileV1` | `candidateId`、`sessionId`、`nativeTags`、`normalizedTags` | 标题本地标签与平台标签的独立视图；任务 8 起按 Session Owner 持久化 |
| `CandidateSignalsV1` | `candidateId`、`sessionId`、`visibleMs`、`hoverMs`、`hoverCount`、`returnCount`、`clicked` | 候选级累计快照，不是原始事件流 |
| `MissedPathV1` | Candidate、Context、`score`、`reasons`、`status`、`createdAt` | 未点击且达到考虑阈值的持久化结果 |
| Chosen | Candidate、Context、`chosenAt` | 已点击候选；结算时绝不进入 Missed Path |
| `RankedReencounterV1` | Missed Path、重逢 `score`、`reasons` | 查询时 DTO，不直接作为历史记录持久化 |
| `ReencounterRecordV1` | `missedPathId`、触发 Context、分数/原因、`shownAt`、可选 outcome/feedbackAt | 卡片展示与用户反馈历史 |
| `SettingsV1` | `enabled`、allowlist/blocklist、两个阈值、`demoMode` | 当前 UI 只修改 `enabled`；清空业务数据时保留 |

`Candidate + Element` 绑定不是领域 DTO。Element 只存在于页面内存的 WeakMap/Map 中，不能进入消息、JSON 或 Repository。

## 多平台共享契约（步骤 5 冻结）

`platform`、`contentType`、`layoutType`、`nativeTags` 四个概念分属不同契约层，不得由各站点线分别发明：

| 概念 | 归属 | 是否持久化 | 派生/来源 |
| --- | --- | --- | --- |
| `platform` | 不进入任何契约字段 | 否 | `shared/types.js` 的 `resolvePlatformFromSource(source)` 纯函数，按精确 `source` 字符串映射到 `PLATFORMS` 枚举；未知 source 返回明确的 `PLATFORMS.UNKNOWN`，不做子串或模糊猜测 |
| `contentType` | `CandidateV1` 可选字段 | 是，随 Candidate/MissedPath/Chosen 持久化 | Adapter 在 `extractCandidates()` 中按站点规则赋值 |
| `layoutType` | `CandidateV1` 可选字段 | 是 | 同上 |
| `nativeTags` | 不属于 `CandidateV1`；属于 `CandidateTagProfileV1` | 是，独立 `tag-candidate` 记录 | Adapter 可选的 `extractCandidateTags()`，或任务 8 的 Provider 富化 |

`CandidateV1.contentType` 与 `CandidateV1.layoutType` 是一对：必须同时出现或同时缺失，`isCandidateV1` 用 `Object.hasOwn` 先检查两者一致，再要求二者都是合法枚举值。只有其中一个字段会被判定为无效数据。**缺失只允许用于兼容任务 8 之前写入的历史 v2 记录**；步骤 5 完成后，Bilibili、知乎、抖音三个真实站点新产生的 Candidate 都必须填写这两个字段。`SCHEMA_VERSION` 保持 2，历史缺字段记录继续有效，不做批量迁移。

枚举值（`shared/types.js`）：

```text
PLATFORMS      = BILIBILI | ZHIHU | DOUYIN | LOCAL_DEMO | UNKNOWN
CONTENT_TYPES  = VIDEO | IMAGE_POST | QUESTION | ANSWER | ARTICLE
LAYOUT_TYPES   = GRID | TEXT_LIST | VIDEO_FEED
```

`PLATFORM_SOURCES` 是精确映射表：`bilibili-search → BILIBILI`、`zhihu-search → ZHIHU`、`douyin-search → DOUYIN`、`local-demo-search → LOCAL_DEMO`。评分 cap 数值（按 platform/contentType/layoutType 选择哪套归一化上限）留给任务 10 与用户一起确认，步骤 5 不预设具体数值。

### Candidate ID 命名空间规则（冻结，供任务 13/15 使用）

Bilibili 现有 ID 直接是裸 BV 号（如 `BV1xx`），**不改变**，避免历史 MissedPath 因 ID 格式变化而重复。新平台各自使用不与 BV 号或彼此冲突的前缀，Adapter 内部保证同一逻辑内容始终生成同一 ID：

```text
Bilibili：<BV 号>                      例如 BV1xx4y1x7abc         （不变）
知乎：    zhihu:<contentType>:<id>      例如 zhihu:question:123456
                                             zhihu:answer:789012
                                             zhihu:article:345678
抖音：    douyin:<contentType>:<id>     例如 douyin:video:7123456789
                                             douyin:image_post:7123456790
```

`id` 取自站点稳定 ID（知乎 question/answer/article ID、抖音 aweme_id），不使用页面渲染顺序或临时 DOM 属性。命名空间前缀只用于避免跨平台碰撞，不替代 `contentType` 字段。

### Adapter 可选能力：`extractCandidateTags`

`SiteAdapter` 的四个必需方法（`canHandle`、`getContext`、`extractCandidates`、`observeChanges`）不变。新增一个**可选**方法：

```text
extractCandidateTags(document) => [{candidateId, nativeTags}, ...]
```

未实现该方法的 Adapter（当前 Demo、Bilibili、知乎）不受影响，Runtime 检测到方法不存在时直接跳过，标签退回任务 7/8 的本地标题/搜索词 fallback。DOM Element 永远不会通过这个方法进入消息或存储；返回值必须是纯数据。

## 标签消息通道（步骤 5 新增）

`CANDIDATE_TAGS_DISCOVERED` 是独立于 `CANDIDATES_DISCOVERED` 的严格消息，只用于把 Adapter 从 DOM 读到的平台原生标签送到 Background：

```text
payload = { sessionId, tags: [{candidateId, nativeTags}, ...], discoveredAt }
```

约束：

- `payload` 不包含 `owner` 字段；Session Owner 仍完全由 Background 根据 Chrome 的 `MessageSender`（`sender.tab.id`/`sender.documentId`/`sender.frameId`）派生，内容脚本无法在 payload 里伪造归属；
- `tags` 非空、批大小不超过 `CANDIDATE_TAGS_BATCH_LIMIT`（50），batch 内 `candidateId` 不得重复；
- 每个 `nativeTags` 受 `TAG_LIMITS` 的长度与数量上限约束，与任务 7 的本地标签共用同一组上限；
- 只关联 `sessionId` + `candidateId`；Background 用当前 Session 中已发现的 Candidate 标题重建 `CandidateTagProfileV1`，`title` 永远来自 Repository，消息中即使携带 `title` 也会被忽略；
- 对不属于当前 Owner Session 的 `candidateId`、已进入 `session-finalization` 的迟到 batch、以及处于非 `OPEN` 状态的 Session，一律拒绝写入而不是静默丢弃；
- 采集暂停（`Settings.enabled === false`）时该通道与 `CANDIDATES_DISCOVERED`/`SIGNALS_UPDATED` 同样被阻止；
- 写入通过 `saveCandidateTagProfile` 走 Repository 既有幂等路径：重复发送相同标签不产生新 commit。

`content/siteRuntime.js` 在每次 `discoverCandidates` 成功后，如果 Adapter 实现了 `extractCandidateTags`，会读取一次并只上报属于本次已接受 Candidate 集合的条目；读取或消息失败都只是静默跳过，绝不影响 discovery、signals 或 finalize。

## 本地标签契约

- `shared/types.js` 是标签数量、文本长度、输入长度和 stop words 的唯一限制来源；`shared/tags.js` 只依赖共享契约并提供纯函数。
- 本地提取只处理搜索词或 Candidate 标题，支持中文、英文、数字和 hashtag；使用 Unicode NFKC、统一大小写和空白后去重，并按确定性顺序输出。
- `nativeTags` 保存经最小清理的平台展示标签，可保留大小写和 `#`；`normalizedTags` 保存用于本地比较的规范形式。两个字段不能互相代替，且每个保留的 native tag 必须在 `normalizedTags` 中有对应项。
- TagProfile 输出及其中数组不可变；纯函数不访问 DOM、storage、网络、Chrome API、模型、时间或随机数，也不修改输入。
- 空值、空标题/query、控制字符、无效 Unicode、纯标点、重复、超长文本和超量标签会安全地产生空结果或受中央上限约束的结果。
- 任务 8 已把 TagProfile 接入 Repository 与按需富化编排；评分、消息、Adapter 和 UI 仍未接入，属于后续任务 10～12。

## 标签持久化与按需富化

`SessionSelectedTagProfileV1` 由 Session 内全部已点击候选聚合而成，字段为 `sessionId`、`selectedCandidateCount` 和按 `candidateCount` 降序、同频次按标签升序排列的 `tags`；每项含 `tag`、`candidateCount` 和 `weight`（= `candidateCount / selectedCandidateCount`）。没有已点击候选时，profile 明确为 `selectedCandidateCount: 0` 且 `tags` 为空，而不是缺失记录。

三个标签 kind 均按 Session Owner 隔离，记录 ID 复用 `createSessionOwnerKey`，`tag-candidate` 再附加经 `encodeURIComponent` 编码的 `candidateId`。因此同一搜索词在两个标签页、或同一标签页的新旧 document 之间不会共享标签数据。本次未提升 `SCHEMA_VERSION`，也没有数据迁移。

富化资格门槛集中在 `background/tagEnrichment.js` 的 `TAG_ENRICHMENT_CONFIG`，与考虑度阈值相互独立：

```text
clicked                → 立即合格
returnCount >= 1       → 合格
hoverMs >= 1200        → 合格
behaviorScore >= 0.35  → 合格
exposure 单独           → 永不合格
```

`behaviorScore` 只使用现有四项行为特征。由于 exposure 单项权重上限为 0.30，低于 0.35，饱和曝光单独无法触发原生标签请求；这是为降低网格中同一行卡片共同曝光导致的误判。每会话最多富化 12 个候选，单候选最多尝试 2 次，退避从 5000ms 起按 2 倍增长。这些值状态为 `UNVALIDATED_PENDING_5_TO_10_PERSON_TEST`。

同一候选的并发请求合并为一次 Provider 调用，成功结果缓存，失败按退避重试。Provider 缓存、并发合并表和退避表只存在于 Worker 生命周期内存中，属于网络优化；权威标签数据全部保存在 Repository，Worker 重启后仍可读取。Provider 失败或缺失一律退回搜索词/标题本地标签，绝不阻塞 finalize。任务 8 的真实运行时 Provider 为 `null`，测试只使用 fake provider；任务 14 审计后知乎仍保持该路径，因为搜索卡片无可见话题，公开 topic-only 路径不可用，其他来源需要整页抓取或 Bearer/登录态。没有新增网络访问或权限。

## Repository 记录种类

Repository 的逻辑 kind 是：

- `session`：Context、Candidate 和各自聚合信号；
- `active-context`：当前 Session/Context，供 Side Panel 查询；
- `session-finalization`：结算时间及 Chosen/Missed Path ID；
- `chosen`：已选择候选；
- `missed-path`：考虑过但未选择的候选；
- `reencounter`：展示和反馈历史；
- `tag-context`：按 Session Owner 隔离的 Context 标签 Profile；
- `tag-candidate`：按 Session Owner 与 `candidateId` 隔离的 Candidate 标签 Profile；
- `tag-selected`：按 Session Owner 隔离的已点击候选标签画像；
- `settings`：采集设置；
- `meta:schema`：Repository schemaVersion。

IndexedDB 只有 `repository-records` 一个对象仓库；逻辑 kind 通过 key 前缀区分。IndexedDB 自身的结构版本只控制对象仓库布局，与 `SCHEMA_VERSION` 记录契约无关；本次对象仓库布局未变化。

首次访问 Repository 时：

- 空库直接写入 v2 `meta:schema`；
- v2 库直接继续使用，不重复改写；
- v1 库会先验证全部记录的信封、kind、ID 和领域数据，再在一个 `commit` 中把全部记录信封和 `meta:schema` 原子升级为 v2；
- 任一验证或写入失败都会保留完整 v1 状态，之后可以安全重试；
- 未知版本以及缺少 `meta:schema` 的非空库明确失败，不会以清空数据代替迁移。

## 消息方向

| 消息 | 发送方 → 接收方 | 目的 |
| --- | --- | --- |
| `PING` / `PONG` | Demo/诊断 → Worker | 检查 Worker 和消息信封 |
| `CANDIDATES_DISCOVERED` | Runtime → Worker | 创建或增量合并 Session Candidate |
| `SIGNALS_UPDATED` | Runtime → Worker | 合并候选级累计信号快照 |
| `CANDIDATE_CHOSEN` | Runtime → Worker | 持久化点击并排除 Missed |
| `SESSION_FINALIZE` | Runtime → Worker | 一次性原子结算 Session |
| `ACTIVE_CONTEXT_QUERY` | Side Panel → Worker | 查询当前搜索 Context |
| `MISSED_PATHS_QUERY` | Side Panel → Worker | 查询 Missed Path DTO |
| `RE_ENCOUNTER_QUERY` | Side Panel → Worker | 对当前 Context 排序 1–3 条候选 |
| `RE_ENCOUNTER_SHOWN` | Side Panel → Worker | 确认实际渲染并开始冷却 |
| `RE_ENCOUNTER_FEEDBACK` | Side Panel → Worker | 记录“打开/稍后/不相关” |
| `SETTINGS_UPDATE` | Side Panel → Worker | 持久化暂停/恢复 |
| `MISSED_PATH_DELETE` | Side Panel → Worker | 单条删除并级联重逢历史 |
| `DATA_DELETE_ALL` | Side Panel → Worker | 清空业务数据并保留 Settings/schema |

消息信封包含 `schemaVersion`、`type`、`requestId` 和 `payload`。校验要求精确字段，未知版本、未知消息、额外字段和非法数值会被拒绝；响应会带回对应 `requestId`，并使用统一成功/错误结构。仍由旧页面脚本发出的 v1 消息会收到旧脚本可识别的 v1 `SCHEMA_VERSION_UNSUPPORTED` 错误，文案明确说明当前要求 v2 并提示刷新页面；未知版本收到当前 v2 错误信封。消息 payload 的字段和含义未改变。

## 合并与幂等不变量

- Session 内按 Candidate ID 和规范化 URL 去重；不同 Context 不能静默合并。
- URL 只接受 HTTP(S)，去掉 fragment 和常见跟踪参数，并稳定排序查询参数。
- `visibleMs`、`hoverMs`、`hoverCount`、`returnCount` 只能单调增加；迟到快照取字段最大值。
- `clicked` 只能从 `false` 变为 `true`。
- 已 finalize 的 Session 不再接受 Candidate 或信号更新。
- finalize 将 marker、Chosen、Missed Path 和活动 Context 清理放进一次 commit；重复请求返回持久化结果。
- 单条删除 Missed Path 时，在一次 commit 中同步删除引用它的 Re-encounter 记录。
- `DATA_DELETE_ALL` 清空所有业务 kind，随后重写 schema 元数据并恢复原 Settings。
- v1→v2 迁移只改 Repository 信封版本，不改领域 data；Settings、Session、Chosen、MissedPath、Reencounter 及其反馈保持原值。

## 启发式参数

考虑度 P0：

```text
C = 0.30 × exposure
  + 0.30 × hover
  + 0.25 × returnView
  + 0.15 × repeatedHover
threshold = 0.55
```

归一化上限分别为 10 秒可见、3 秒 Hover、2 次回看、3 次重复 Hover。`clicked=true` 时直接归类为 `EXCLUDED_CLICKED`，分数为 0。

重逢 v2（方案 A，2026-08-29 批准）：

```text
R = 0.45 × keywordContextSimilarity
  + 0.15 × tagSimilarity
  + 0.25 × priorConsideration
  + 0.15 × freshness
  - cooldownPenalty
  - repeatedDismissalPenalty
threshold = 0.60, result limit = 1..3
```

Context 相似度是搜索词/关键词集合的 Jaccard 相似度。标签相似度比较历史 Candidate 标签与当前 Context 标签；当前 Session 有已点击候选时使用 `0.75 × Context 标签相似度 + 0.25 × Selected Profile 相似度`，无点击时只使用 Context 标签。历史或当前标签缺失时标签贡献为 0，保留原有关键词/Jaccard 路径，不重复奖励关键词。当前 Active Context 和 TagProfile 由 Background 按激活 tab/Session Owner 读取；Side Panel 不访问 storage，也不发送 owner。新鲜度视野为 30 天；展示后冷却为 24 小时；`NOT_RELEVANT`/历史 `DISMISSED` 会累计惩罚。不存在同平台自动加分，也没有模型、Embedding 或网络回退。

上述参数状态是 `UNVALIDATED_PENDING_5_TO_10_PERSON_TEST`。文档中的数值是代码事实，不代表已经完成用户效果校准。

## 数据最小化与保留

持久化的是搜索词、候选标题/URL、来源/排名、聚合计数、分数/原因和反馈；不持久化 DOM Element、完整正文、键盘/表单、Cookie/Token、截图或逐点鼠标轨迹。

当前 P0 没有自动过期清理策略。用户通过 Side Panel 暂停、单条删除或清空业务数据；完全清除 Settings 等扩展状态需要浏览器级移除扩展或清理扩展存储。
