# 数据契约

The Unclicked 当前唯一共享契约版本是 `SCHEMA_VERSION = 2`。领域校验在 `shared/types.js`，Chrome 消息信封和 payload 校验在 `shared/messages.js`，持久化二次校验与 v1→v2 迁移在 `storage/repository.js`。原有领域 DTO 仍保留 `V1` 名称和字段；标签以独立 TagProfile DTO 表达，不改变 `CandidateV1`、消息 payload 或当前 Repository 记录。

## 领域对象

| 对象 | 保存的最小字段 | 生命周期/用途 |
| --- | --- | --- |
| `CandidateV1` | `id`、规范化 `url`、`title`、`source`、`rank`、`sessionId` | Adapter 输出；不含 Element |
| `SearchContextV1` | `query`、`source`、`timestamp`、可选 `keywords` | 会话与重逢的最小情境 |
| `ContextTagProfileV1` | `sessionId`、稳定排序的 `normalizedTags` | 由搜索词本地提取；当前只生成 DTO，不持久化 |
| `CandidateTagProfileV1` | `candidateId`、`sessionId`、`nativeTags`、`normalizedTags` | 标题本地标签与平台标签的独立视图；当前只生成 DTO，不持久化 |
| `CandidateSignalsV1` | `candidateId`、`sessionId`、`visibleMs`、`hoverMs`、`hoverCount`、`returnCount`、`clicked` | 候选级累计快照，不是原始事件流 |
| `MissedPathV1` | Candidate、Context、`score`、`reasons`、`status`、`createdAt` | 未点击且达到考虑阈值的持久化结果 |
| Chosen | Candidate、Context、`chosenAt` | 已点击候选；结算时绝不进入 Missed Path |
| `RankedReencounterV1` | Missed Path、重逢 `score`、`reasons` | 查询时 DTO，不直接作为历史记录持久化 |
| `ReencounterRecordV1` | `missedPathId`、触发 Context、分数/原因、`shownAt`、可选 outcome/feedbackAt | 卡片展示与用户反馈历史 |
| `SettingsV1` | `enabled`、allowlist/blocklist、两个阈值、`demoMode` | 当前 UI 只修改 `enabled`；清空业务数据时保留 |

`Candidate + Element` 绑定不是领域 DTO。Element 只存在于页面内存的 WeakMap/Map 中，不能进入消息、JSON 或 Repository。

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

同一候选的并发请求合并为一次 Provider 调用，成功结果缓存，失败按退避重试。Provider 缓存、并发合并表和退避表只存在于 Worker 生命周期内存中，属于网络优化；权威标签数据全部保存在 Repository，Worker 重启后仍可读取。Provider 失败或缺失一律退回搜索词/标题本地标签，绝不阻塞 finalize。任务 8 只使用 fake provider，没有真实平台网络访问，也没有新增权限。

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

重逢 P0：

```text
R = 0.45 × keywordContextSimilarity
  + 0.25 × priorConsideration
  + 0.15 × noveltyOrDivergence
  + 0.15 × freshness
  - cooldownPenalty
  - repeatedDismissalPenalty
threshold = 0.60, result limit = 1..3
```

Context 相似度是搜索词/关键词集合的 Jaccard 相似度；新鲜度视野为 30 天；展示后冷却为 24 小时；`NOT_RELEVANT`/历史 `DISMISSED` 会累计惩罚。P0 的 `noveltyOrDivergence` 固定为 0，因为当前没有可靠且可解释的本地信号，也没有模型或 Embedding 回退。

上述参数状态是 `UNVALIDATED_PENDING_5_TO_10_PERSON_TEST`。文档中的数值是代码事实，不代表已经完成用户效果校准。

## 数据最小化与保留

持久化的是搜索词、候选标题/URL、来源/排名、聚合计数、分数/原因和反馈；不持久化 DOM Element、完整正文、键盘/表单、Cookie/Token、截图或逐点鼠标轨迹。

当前 P0 没有自动过期清理策略。用户通过 Side Panel 暂停、单条删除或清空业务数据；完全清除 Settings 等扩展状态需要浏览器级移除扩展或清理扩展存储。
