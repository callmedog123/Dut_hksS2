# The Unclicked（余路）v2 开发路线图与 AI 任务提示词

> 状态：发展阶段决策基线  
> 建立日期：2026-08-28  
> 建立时仓库 HEAD：`80aae7e`  
> 用途：跨设备、跨 AI 对话持续开发时的仓库内权威上下文

## 1. 如何使用本文档

历史 AI 对话不是项目事实来源。换设备、重新克隆仓库或新开 AI 对话后，应优先读取本文档和当前代码，再决定下一项任务。

事实优先级如下：

1. 当前 Git 工作树、代码、Manifest 和自动测试；
2. 本文档中已经明确标记为“已确认”的产品决策；
3. `README.md`、`docs/architecture.md`、`docs/data-contract.md` 和 `docs/permissions-and-privacy.md`；
4. 旧开发手册、旧提示词和历史材料只能作为参考，不能覆盖当前代码事实。

执行规则：

- 一次只实施一个编号任务。
- 开始前检查仓库和未提交改动，不覆盖或回退他人的工作。
- 完成后运行该任务要求的专项测试和全仓验证。
- 只有代码、测试和文档一致时，才能把任务标为 `COMPLETED`。
- AI 不得自行 commit、push、force push、打 tag 或创建发布包。
- 新权限、Host Permission、网络端点、第三方服务、依赖、模型或后端必须设置用户确认点。
- 切换设备前，应由用户确认改动、commit 并推送；不要依赖未提交文件或 AI 对话历史。

## 2. 当前仓库事实基线

建立本文档时的实际状态：

- 分支：`main...origin/main`；
- 工作树：干净；
- HEAD：`80aae7e`；
- Chrome Manifest V3，最低 Chrome 114；
- `SCHEMA_VERSION = 1`；
- Manifest 只有 `sidePanel` 权限和 `https://search.bilibili.com/*` Host Permission；
- Content Script 仍固定加载 `content/bilibiliRuntime.js`；
-真实站点 Registry 只注册 Bilibili Search Adapter；
- Repository 的 Active Context 使用全局固定记录 ID `current`；
- Bilibili 页面退出仍通过 `pagehide`/`beforeunload` best-effort 异步结算；
- 当前没有 Session Owner、持久化结算租约、遗留 Session 自动恢复；
- 当前没有标签类型、标签 Repository、TagProvider 或标签增强评分；
- 当前没有知乎或抖音 Adapter；
- Consideration 仍使用 exposure、hover、return view、repeated hover 四项固定启发式；
- Re-encounter 仍使用关键词/Jaccard、历史考虑、新鲜度、冷却和重复负反馈。

建立本文档前的自动验证：

| 验证 | 结果 |
| --- | --- |
| JavaScript 语法检查 | 77 个文件通过 |
| `node --test` | 315/315 通过，0 失败 |
| `scripts/validate-build.js` | 通过 |
| `scripts/validate-release.js` | 通过 |
| 当前终端 `npm` | 不可用；底层 Node 命令已直接运行 |

此处测试数只是建立文档时的基线。后续新增测试后，不能继续把 315 当作固定目标；应以“全部通过且无旧测试回归”为准。

## 3. 已确认的产品发展意见

### 3.1 “认真考虑过”的判断

现有信号继续保留：

- `visibleMs`；
- `hoverMs`；
- `hoverCount`；
- `returnCount`；
- `clicked` 继续作为绝对排除条件。

但不能再只依靠四类行为信号判断 Missed Path。Bilibili 网格中同一行卡片可能同时进入视口，导致 exposure 近似，降低区分度。

新增标签系统：

- 搜索词生成 Context 标签；
- 每个 Candidate 生成 Candidate 标签；
- 优先使用平台原生标签；
- 无法获取原生标签时，退回搜索词和标题的本地标签；
- 只为产生明显行为信号或进入结算范围的候选按需请求原生标签；
- 一个 Session 中的已点击候选共同形成 Selected Tag Profile；
- 多个已点击候选重复出现的重合标签获得更高权重；
- 未点击候选与 Selected Tag Profile 的标签契合度参与 Consideration；
- 该特征只能占中低权重，不能压过真实行为，也不能单独让候选成为 Missed Path；
- 没有点击候选时，退回搜索词标签和行为信号；
- 标签只供后台判断和可解释 reasons 使用，不提供用户编辑 UI。

精确公式、标签项权重、最低行为门槛和平台归一化上限尚未冻结，必须在任务 10 中先提出方案并等待确认。

### 3.2 原生标签与网络边界

用户原则上允许为了平台原生标签增加最小必要的平台数据访问范围，但尚未批准任何具体新增域名或端点。

约束：

- 不为所有搜索结果批量请求标签；
- 只为通过标签富化门槛的候选请求；
- 同一候选并发请求必须合并；
- 结果应缓存并有失败退避；
- 请求失败不能阻塞 Session 或 finalize；
- 不读取 Cookie、Token、密码、表单、完整正文、评论或用户资料；
- 不逆向签名、不绕过反爬、不模拟私有客户端；
- 如果只能依赖登录态私有接口，放弃原生标签并使用本地 fallback；
- 每个实际 Host Permission 必须在修改 Manifest 前单独列出并确认。

### 3.3 多标签页和强制退出恢复

已确认：

- 每个标签页和页面实例拥有独立 Session；
- Candidate、signals、Context、Tag Profile 和 finalize 不得跨标签页混合；
- Side Panel 只展示当前激活标签页的 Active Context 和 Re-encounter；
- 标签页切换后重新查询，并忽略上一标签页迟到响应；
- 信号使用低频、单调、绝对累计快照持久化；
- `pagehide`/`beforeunload` 只作为优化，不能作为唯一结算保障；
- 浏览器强制退出后，下次启动根据最后持久化快照自动结算；
- 有有效信号的遗留 Session 正常结算；
- 没有候选或没有有意义信号的遗留 Session 标记为 `ABANDONED`；
- finalize 必须有持久化状态、租约、确定性 ID 和原子 marker；
- Worker 中途终止后，租约过期可由新 Worker 接管；
- 重复恢复扫描不能生成重复 Chosen 或 Missed Path。

### 3.4 多平台范围

| 平台 | 第一阶段支持 | 明确排除 |
| --- | --- | --- |
| Bilibili | 视频搜索结果 | 广告、非视频结果、其他未批准页面 |
| 知乎 | 问题、回答、文章 | 用户、广告、无稳定永久链接的结果 |
| 抖音 | 普通视频、图文作品 | 用户主页、话题、直播、商品、广告 |

允许 Bilibili、知乎和抖音之间跨平台情境化重逢。

要求：

- Candidate ID 必须带平台/类型命名空间，避免跨平台碰撞；
- Side Panel 明确显示原始平台和内容类型；
- 不因“同平台”自动给予决定性加分；
- 跨平台匹配使用统一规范化标签；
- DOM 选择器只存在于各平台 Adapter；
- Adapter 不评分、不访问 Repository、不直接操作 Side Panel；
- 不使用 `<all_urls>`。

## 4. 继续冻结的产品与隐私边界

- local-first，业务数据保存在扩展自身 IndexedDB；
- 不保存完整网页正文、评论、完整鼠标轨迹、鼠标坐标或 DOM Element；
- 不采集键盘、表单、密码、Cookie 或 Token；
- 不调用大模型、Embedding、第三方后端或遥测服务；
- 不把搜索和 Repository 数据上传到团队服务器；
- Side Panel 不直接访问 storage，不重新计算 score、status、排序或 reasons；
- 所有写操作经过 Background/Repository；
- MV3 Service Worker 可随时休眠，关键状态必须持久化、可恢复、幂等；
- 新依赖、新权限、新网络范围必须单独确认；
- 一次只做一个边界清晰的任务，不顺手重构其他模块。

## 5. 目标架构

```text
Bilibili / Zhihu / Douyin Search Page
                  │
                  ▼
          Platform Site Adapter
   selectors / context / candidates / native visible tags
                  │
                  ▼
         Generic Real-site Runtime
 binding / visibility / hover / return / click / checkpoints
                  │
                  ▼
     Strict Versioned Messages + Sender Owner
                  │
                  ▼
 Service Worker / Router / Recovery Coordinator
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
 Session + Tag Profiles   Scoring Use Cases
        │                   │
        └─────────┬─────────┘
                  ▼
       IndexedDB Repository
                  │
                  ▼
      Strict Missed/Reencounter DTO
                  │
                  ▼
 Side Panel for the currently active browser tab
```

## 6. 开发顺序与状态

状态定义：

- `PENDING`：尚未开始；
- `IN_PROGRESS`：存在未完成改动或验证；
- `COMPLETED`：实现、测试和文档一致；
- `BLOCKED`：等待用户选择、权限或外部事实。

| 编号 | 任务 | 优先级 | 前置 | 状态 |
| --- | --- | --- | --- | --- |
| 0 | 建立本路线图 | P0 | 无 | COMPLETED |
| 1 | 抽取通用真实站点 Runtime | P0 | 0 | COMPLETED |
| 2 | schemaVersion 2 与 v1 数据迁移 | P0 | 1 | COMPLETED |
| 3 | Session Owner 与多标签页 Active Context | P0 | 2 | COMPLETED |
| 4 | 信号检查点与持久化 Session 生命周期 | P0 | 3 | COMPLETED |
| 5 | Worker/浏览器重启后的自动恢复结算 | P0 | 4 | COMPLETED |
| 6 | Side Panel 跟随当前激活标签页 | P0 | 5 | COMPLETED |
| 7 | 本地标签纯函数与共享类型 | P1 | 2 | COMPLETED |
| 8 | 标签 Repository 与懒加载 Provider | P1 | 4、7 | COMPLETED |
| 9 | Bilibili 原生标签权限审计与实现 | P1 | 8 | PARTIAL（基础接线 COMPLETED；原生标签能力当前未实现） |
| 10 | 冻结 Consideration v2 公式 | P1 | 7、8 | COMPLETED |
| 11 | 实施 Consideration v2 | P1 | 10 | COMPLETED |
| 12 | 跨平台 Re-encounter v2 | P1 | 11 | COMPLETED |
| 13 | 知乎 Adapter 与 Runtime | P2 | 6、8、12 | COMPLETED |
| 14 | 知乎原生标签增强 | P2 | 13 | PARTIAL（审计与 fallback COMPLETED；原生 Provider 未实现） |
| 15 | 抖音 Adapter 与 Runtime | P2 | 6、8、12 | PENDING |
| 16 | 抖音原生标签增强 | P2 | 15 | PENDING |
| 17 | 三平台最终集成与发布验收 | P0 | 9、12、14、16 | PENDING |

任务 13 和 15 在基础设施完成后可以分别开发，但同一工作树中仍应一次只执行一个，避免共享 Registry、Manifest 和 Runtime 冲突。

### 6.1 任务 1 完成记录（2026-08-28）

- 开始 HEAD：`f8926eb`；
- 新增 `content/siteRuntime.js`，承接候选发现、Candidate/Element binding、visibility、hover、click、signals、SPA 和 finalize 编排；
- `content/bilibiliRuntime.js` 保留原有兼容导出，改为创建 Bilibili Adapter 并注入通用 Site Runtime 的薄包装；
- Demo Runtime、Bilibili DOM Adapter、消息协议、Repository、评分、权限和 Side Panel 行为未改变；
- `manifest.json` 只在原有严格 Bilibili 资源范围中加入 `content/siteRuntime.js`，未扩大权限、host 或 content-script matches；
- 专项 Runtime/Adapter/build 测试：33/33 通过；全仓 `node --test` 与 `npm test`：319/319 通过；
- `npm run typecheck`：79 个 JavaScript 文件语法检查通过；`npm run build`：build/release validation 通过；
- 本任务未执行真实 Chrome 手动验收；发布前仍需按 `docs/manual-browser-checklist.md` 验证真实浏览器行为。

### 6.2 任务 2 完成记录（2026-08-28）

- 唯一共享 `SCHEMA_VERSION` 从 1 升级为 2，现有消息 payload 与领域 DTO 字段保持不变；
- Repository 在首次访问时区分空库、v2、可迁移 v1、未知版本和无元数据非空库；
- 完整 v1 数据会先逐类验证，再通过单次原子 `commit` 升级全部记录信封及 `meta:schema`，失败保持完整 v1 状态，重复执行不重复写入；
- Settings、Session、Active Context、Chosen、MissedPath、Session Finalization、Reencounter 及反馈迁移后均可查询，删除、清空和 Worker 重启恢复保持可用；
- 旧页面的 v1 消息会收到 `SCHEMA_VERSION_UNSUPPORTED`，错误文案明确要求刷新页面；
- 未加入标签、多标签页、评分、Adapter、UI 或权限变化；
- 迁移专项 6/6、Worker 恢复 11/11、全仓 `npm test` 328/328 通过；`npm run typecheck` 检查 80 个 JavaScript 文件通过，`npm run build` 的 build/release validation 通过；
- 本任务未执行真实 Chrome 手动验收；提交候选版本前仍应单独验证升级旧扩展数据后的真实浏览器行为。

### 6.3 任务 3 完成记录（2026-08-28）

- 新增严格 `SessionOwnerV1`，由 Background 仅根据 `chrome.runtime.MessageSender` 的 `tab.id`、`documentId`、`frameId` 与消息中的 `sessionId` 生成；Content payload 不接受 owner，非主 frame 写入明确拒绝；
- Session、signals、chosen、finalize marker 和最终 Chosen/Missed Path ID 均使用 owner 隔离，同一 query/内容 sessionId 在不同 tab 或 document 中不会合并；
- Active Context 改为 tab/document 所有权记录；同一 tab 的较新 document 成为当前 Context，较旧 document 的迟到发现不会覆盖它，单 tab finalize 不删除其他 tab Context；
- `ACTIVE_CONTEXT_QUERY` 和 `RE_ENCOUNTER_SHOWN` 由 Background 通过 `chrome.tabs.query({ active: true, lastFocusedWindow: true })` 解析当前激活 tab，再查询或校验对应 Context；
- 经 Chrome 官方 Tabs API 文档确认，查询 tab ID 本身不需要新增 `tabs` 或 `activeTab` 权限；Manifest 未修改权限或站点范围；
- v1→v2 迁移形成的 legacy Session/Context 继续可由兼容 Repository API 查询，但无 owner 的全局 Context 不会作为任何当前 tab Context 返回；
- Owner/多标签页/Worker 恢复专项测试 19/19、全仓 `node --test` 与 `npm test` 336/336 通过；`npm run typecheck` 检查 83 个 JavaScript 文件通过；`npm run build` 的 build/release validation 通过；
- 本任务未执行真实 Chrome 多标签页手动验收；任务 6 完成 Side Panel 标签切换监听后仍需补做真实浏览器矩阵。

### 6.4 任务 7 完成记录（2026-08-28）

- 新增 `shared/tags.js`，提供 Unicode NFKC、大小写/空白归一化、中英文/数字/hashtag 提取、stop words、去重、确定性排序及长度/数量上限；所有函数均为本地纯函数，不访问 DOM、storage、网络、Chrome API、模型、时间或随机数；
- `shared/types.js` 新增唯一严格 `ContextTagProfileV1` 与 `CandidateTagProfileV1` 契约及 validator；标签限制和 stop words 只有一个共享常量来源；
- `nativeTags` 保留平台展示标签，`normalizedTags` 保存比较形式，严格分栏且 validator 要求每个 native tag 都有对应 normalized tag；
- `CandidateV1`、`SearchContextV1`、schemaVersion 2、消息 payload、Repository、Provider、评分、Runtime、Adapter、权限和 UI 均未改变；Task 8 的持久化和富化接线未提前实现；
- 标签/共享类型/build 专项测试 37/37 通过；全仓 `node --test` 与 `npm test` 均为 371/371 通过；`npm run typecheck` 检查 88 个 JavaScript 文件通过；`npm run build` 的 build/release validation 通过；
- A-1 只增加纯函数和 DTO，没有新增真实浏览器行为；本任务未把自动测试表述为 Chrome 手动验收。

### 6.5 任务 8 完成记录（2026-08-28）

- 开始 HEAD：`7f1c950`；本任务只使用 fake provider，未接入任何真实平台网络；
- 用户已批准「方案 A 保守」富化门槛，集中冻结在 `background/tagEnrichment.js` 的
  `TAG_ENRICHMENT_CONFIG`：clicked 立即合格、`returnCount >= 1`、`hoverMs >= 1200`、
  `behaviorScore >= 0.35`，且 `exposureAloneQualifies: false`；每会话最多富化 12 个候选、
  单候选最多 2 次尝试、退避 5000ms 起按 2 倍增长；
- 该门槛与 `CONSIDERATION_SCORING_CONFIG.threshold` 完全独立，并有测试断言其独立性；
  由于 exposure 单项权重上限为 0.30 < 0.35，饱和曝光单独永远无法触发原生标签请求，
  这正是针对网格整行共同曝光的设计意图，并有专项测试覆盖；
- 新增三个 owner 隔离的 Repository kind：`tag-context`、`tag-candidate`、`tag-selected`，
  记录 ID 复用 `createSessionOwnerKey`，`candidateId` 经 `encodeURIComponent` 编码，
  含分隔符的 candidateId 仍可寻址；未新增 schemaVersion，未迁移数据；
- 同一候选并发请求合并为一次 provider 调用，成功结果缓存，失败按退避重试并在
  达到上限后停止；provider 失败一律退回任务 7 的搜索词/标题本地标签，绝不阻塞 finalize；
- 多个 clicked 候选共同形成 `SessionSelectedTagProfileV1`，重复出现的标签获得更高
  `candidateCount`/`weight`；无点击时明确持久化为空 profile 而非缺失；
- 级联语义按批准执行：`deleteSession` 与 `deleteAll` 清除标签数据，单条
  `deleteMissedPath` 明确保留同会话标签 Profile（同会话其他 Missed Path 仍需使用）；
- provider 缓存/并发表/退避表只存在于 Worker 生命周期内存，属网络优化；权威标签
  数据全部在 Repository，Worker 重启后仍可读取，并有测试覆盖；
- 未修改评分、Manifest、权限、Adapter、Side Panel、消息协议或 Runtime；
- 标签富化与标签 Repository 专项测试 31/31 通过；全仓 `node --test` 与 `npm test`
  均为 402/402 通过；`npm run typecheck` 检查 92 个 JavaScript 文件通过；
  `npm run build` 的 build/release validation 通过；`git diff --check` 通过；
- 本任务未执行真实 Chrome 手动验收，也未接入真实平台标签数据源；任务 9 仍需先做
  只读权限审计并等待用户批准。

### 6.6 步骤 5：多平台共享契约冻结完成记录（2026-08-28）

- 开始 HEAD：`f9738c5`（任务 8）；本步骤不实现任何知乎/抖音选择器，未修改
  `manifest.json`，未实施评分；
- 用户已批准方案 A：`CandidateV1` 新增成对可选 `contentType`/`layoutType`，
  `SCHEMA_VERSION` 保持 2，不做 v2→v3 深层迁移；
- `isCandidateV1` 用 `Object.hasOwn` 检查两个字段必须同时出现或同时缺失，
  只有其中一个会被判定为无效；历史 v2 记录缺字段继续有效，不改写历史数据；
  新的真实站点 Candidate 从本步骤起应填写两个字段；
- 新增 `PLATFORMS`、`CONTENT_TYPES`、`LAYOUT_TYPES` 枚举与精确 `PLATFORM_SOURCES`
  映射表；`resolvePlatformFromSource(source)` 纯函数按精确字符串匹配派生
  platform，不做子串/模糊猜测，未知 source 返回明确 `UNKNOWN`；platform 本身
  不持久化、不进入任何契约字段；
- 评分 cap 数值明确留给任务 10 与用户一起确认，本步骤未预设具体数值；
- `nativeTags` 未加入 `CandidateV1`；新增独立严格消息
  `CANDIDATE_TAGS_DISCOVERED`（`shared/messages.js`），payload 为
  `{sessionId, tags: [{candidateId, nativeTags}], discoveredAt}`，不含 owner；
  Session Owner 仍完全由 Background 根据 `MessageSender` 派生；
- 新增 Background 用例 `background/candidateTagsUpdate.js`：Candidate 必须属于
  当前 Owner 的 OPEN Session 才接受标签，已 finalize 的迟到 batch 被拒绝且不
  改动已有标签数据，`title` 永远来自 Repository 而非消息，重复提交同一批标签
  幂等不产生新 commit；
- `content/siteRuntime.js` 在 discovery 成功后调用 Adapter 可选的
  `extractCandidateTags(document)`（若实现），只上报属于当前已接受 Candidate
  集合的条目；未实现该方法或读取/发送失败都静默跳过，不影响 discovery、
  signals 或 finalize；`SiteAdapter` 四个必需方法未变；
- 冻结知乎 `zhihu:<contentType>:<id>`、抖音 `douyin:<contentType>:<id>` 的
  Candidate ID 命名空间规则；Bilibili 现有裸 BV ID 不变，避免历史 MissedPath
  因 ID 格式变化重复；
- 更新 `docs/data-contract.md`（多平台共享契约、Adapter 可选能力、标签消息
  通道）与 `docs/architecture.md`（数据流图、模块边界表）；
- 修改文件：`shared/types.js`、`shared/messages.js`、`background/messageRouter.js`、
  `background/serviceWorker.js`、`content/siteRuntime.js`；新增
  `background/candidateTagsUpdate.js`；测试新增/修改：
  `tests/shared/types.test.js`、`tests/messages.test.js`、
  `tests/background/messageRouter.test.js`、`tests/content/siteRuntime.test.js`、
  `tests/background/candidateTagsUpdate.test.js`；
- 专项测试覆盖：CandidateV1 成对校验、platform 精确解析、
  `CANDIDATE_TAGS_DISCOVERED` 严格字段/批量上限/去重/无 owner、Background 用例的
  Session 归属校验/finalize 后拒绝/非 OPEN 拒绝/幂等、真实
  `createSiteRuntime` + 真实 `createMessageRouter` + 真实 `createRepository`
  端到端集成（含无 `extractCandidateTags` 场景与跨 Candidate 边界丢弃场景）、
  暂停采集阻断标签写入、双 Owner 隔离；
- 全仓 `node --test` 与 `npm test` 均为 430/430 通过；`npm run typecheck`
  检查 94 个 JavaScript 文件通过；`npm run build` 的 build/release validation
  通过；`git diff --check` 通过；
- 本步骤未执行真实 Chrome 手动验收；未接入任何真实知乎/抖音站点；未修改
  Manifest 权限或 host_permissions。

### 6.7 任务 9 完成记录（2026-08-29）

- 开始 HEAD：`f9738c5`（任务 8）；本任务不新增权限、不接入公开 API、不使用
  WBI/签名/Cookie/Token/登录接口；
- 真实 Chrome DevTools 审计结果（`https://search.bilibili.com/all?keyword=奶龙无敌`，
  Chrome 152，未登录）：
  - `.video-list .bili-video-card` 选择器有效，共 42 张卡片；
  - 卡片可见叶子节点只有：播放量、弹幕量、时长、作者、日期、`.keyword` 搜索词高亮；
  - 查询 class 含 `tag/topic/keyword/label` 的节点时只发现 keyword 高亮；
  - 肉眼未见每张卡片内存在话题/hashtag/视频原生标签；
  - 页面顶部筛选项不属于 Candidate 标签；
  - **结论**：当前 Bilibili 搜索卡片 DOM 没有稳定、可见、可作为 `nativeTags` 的原生视频标签；
- 按用户批准边界实施：
  - 不申请新权限；
  - 不审查或接入公开 API；
  - Bilibili 当前版本只使用标题和搜索词的本地 fallback；
  - 文档如实说明 Bilibili 原生标签当前未实现；
- 实现内容：
  - Service Worker 装配真实 `tagEnrichmentCoordinator`（provider 为 `null`，只做本地 fallback）；
  - 消息路由在 `CANDIDATES_DISCOVERED` 后调用 `recordContextTags` 和 `enrichCandidate`；
  - `SIGNALS_UPDATED` 后调用 `enrichCandidate`（best-effort，不阻塞主流程）；
  - `SESSION_FINALIZE` 前调用 `refreshSelectedTagProfile`（best-effort）；
  - `enrichCandidate` 复用已保存的非空 `nativeTags`，空 `nativeTags` 不被误认为 Provider 成功缓存；
  - 标签写入失败不阻塞 discovery/signals/finalize；
- 修改文件：`background/tagEnrichment.js`、`background/messageRouter.js`、
  `background/serviceWorker.js`；
- 测试新增：`tests/content/siteRuntime.test.js` 真实 Runtime→Router→Repository 本地
  fallback 集成测试（验证 Context/Candidate Profile 持久化、finalize 后 selected profile
  刷新）；
- 全仓 `node --test` 与 `npm test` 均为 431/431 通过；`npm run typecheck` 检查 94 个
  JavaScript 文件通过；`npm run build` 的 build/release validation 通过；
- 权限/网络变化：无；Manifest 未修改；
- 真实 Chrome 手动验收：未执行；
- 任务状态：
  - 基础接线与本地 fallback：**COMPLETED**；
  - Bilibili 原生标签能力：**PARTIAL**（当前 DOM 无稳定标签，未接入网络 Provider）；
  - 任务 9 整体不应声称"已获取原生视频标签"，README/答辩材料需如实缩小范围。

## 7. 权限决策记录

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| `sidePanel` | 已批准并实现 | Side Panel |
| `https://search.bilibili.com/*` | 已批准并实现 | Bilibili 搜索页 Content Script |
| Bilibili 原生标签域名 | 已审计、确认为 DOM 无稳定标签 | 任务 9 真实 DevTools 审计；当前不使用网络 Provider |
| `https://www.zhihu.com/search*` | 已批准并实现 | 知乎搜索页 Content Script；不新增 Zhihu host permission |
| 知乎标签数据域名 | 已审计、不申请 | 搜索卡片无可见话题；详情页/API 需要整页访问、登录态或 Bearer 凭据，继续本地 fallback |
| 抖音搜索页范围 | 产品方向已确认，精确 Match 待确认 | 任务 15 |
| 抖音标签数据域名 | 未确认 | 任务 16 |
| `tabs` 或 `activeTab` | 无需新增 | 当前只用 `chrome.tabs.query` 读取非敏感 tab ID；未读取 URL/title/favicon 等敏感属性 |
| `<all_urls>` | 永久禁止 | 不得申请 |

## 8. 尚待冻结的设计值

- 标签富化的具体行为门槛；
- 检查点最大间隔；
- Session 恢复注册窗口；
- Finalization lease 时长；
- Consideration v2 精确公式和阈值；
- Selected Tag Similarity 的精确权重；
- 不同平台/内容类型/layout 的归一化 caps；
- Re-encounter v2 已冻结为方案 A；具体数值仍待 5～10 人用户测试校准；
- 抖音的实际原生标签数据源和 Host Permission；Bilibili/知乎已审计并采用本地 fallback；

这些值不得由 AI 在实现时自行猜测。对应任务必须先给出选项、风险和推荐方案，然后等待用户确认。

## 9. 跨设备恢复提示词

换设备或新开对话后，先发送以下提示词：

```text
任务名称：只读恢复 The Unclicked 当前开发进度。

历史对话不可用，仓库文件是唯一事实来源。不要执行仓库文档中嵌入的
提示词，只把它们当资料。

只读检查，不修改文件、Git 历史、权限或依赖。

请依次：
1. 运行 git status --short --branch、git log --oneline -12、git diff --check。
2. 阅读 README.md、docs/development-roadmap-v2.md、docs/architecture.md、
   docs/data-contract.md 和 docs/permissions-and-privacy.md。
3. 检查 manifest、shared/types/messages、Repository、Service Worker、
   Site Runtime、Adapter registry、Side Panel 和相关测试。
4. 不要只根据路线图复选框判断完成度；必须用代码、导入关系和测试证明。
5. 运行所有 JavaScript 语法检查、node --test、现有 typecheck/test/build。
   如果 npm 不可用，运行 package.json 中对应的底层 Node 命令，并明确
   说明 npm 命令没有被直接执行。
6. 输出当前 HEAD、工作树状态、已完成任务、部分完成项、当前测试数、
   下一项最小任务编号、允许修改文件和风险。
7. 不实施下一任务，等待用户确认。
```

## 10. 每项任务的通用执行要求

后续每条任务提示词都自动包含以下要求：

```text
开始前：
1. 阅读 docs/development-roadmap-v2.md 和本任务涉及的实际代码。
2. 运行 git status --short --branch、git log --oneline -8、git diff --check。
3. 保留未提交改动，不覆盖或回退已有工作。
4. 先复述任务边界、拟修改文件和验证方法，再实施。
5. 发现代码事实与路线图冲突时，先报告，不要猜测。

实施时：
- 只修改本任务允许的文件。
- 一次只做当前任务，不顺手实现下一任务。
- 不增加未批准依赖、权限、服务、后端或模型。
- DOM 选择器只存在于对应 Adapter。
- Side Panel 不访问 storage 或计算业务状态。
- 所有存储写操作必须经过 Background/Repository。

完成后：
1. 运行所有 JavaScript 语法检查、专项测试、node --test、typecheck/test/build。
2. npm 不可用时运行 package.json 对应底层 Node 命令，并明确说明。
3. 报告修改文件、命令、测试数量、结果、兼容处理和限制。
4. 仅在全部验证通过后更新本路线图任务状态和测试基线。
5. 不 commit、不 push、不打 tag、不创建发布包。
```

## 11. 任务提示词

### 任务 1：抽取通用真实站点 Runtime

```text
任务名称：将 Bilibili Runtime 抽取为通用 Site Runtime，保持行为不变。

目标：
把候选发现、binding、visibility、hover、click、signals 和 finalize 编排抽到
站点无关 Runtime。Bilibili Adapter 继续拥有所有 Bilibili DOM 逻辑；消息、
存储和浏览器行为不能变化。

允许修改：
- content/siteRuntime.js（可新增）
- content/bilibiliRuntime.js
- content/contentScript.js
- content/adapters/registry.js
- scripts/validate-build.js 的必要模块图校验
- 对应 Runtime、Adapter、build 测试
- docs/development-roadmap-v2.md 的状态与验证记录

要求：
- Demo Runtime 暂时保持独立。
- Site Runtime 只能依赖 Adapter 接口，不出现站点选择器。
- Bilibili Runtime 可以成为薄包装，但保留现有兼容导出。
- 不实现多标签、恢复、标签、知乎或抖音。
- 不修改评分、Repository、共享协议、权限或 Side Panel。

验收：
Bilibili 初始/动态/SPA/点击/结算/cleanup、Demo 和全仓测试无回归。
```

### 任务 2：schemaVersion 2 与 v1 数据迁移

```text
任务名称：建立 schemaVersion 2 和 v1 本地数据原子迁移。

目标：
把唯一共享 SCHEMA_VERSION 从 1 升级到 2，并让已有 IndexedDB v1 记录
原子、幂等迁移到 v2。本任务只建立版本与迁移基础，不加入标签或多标签
业务字段。

要求：
- schemaVersion 仍只有一个共享常量来源。
- 当前消息 payload 语义保持不变，只升级协议版本。
- Settings、Session、Chosen、MissedPath、Reencounter 和反馈不得丢失。
- 迁移失败必须完整回滚，不能留下半迁移状态。
- 重复运行迁移幂等；未知版本明确失败。
- 旧页面发出的 v1 消息返回明确版本不兼容错误，提示刷新页面。
- 不以清空用户数据代替迁移。

允许修改：
- shared/types.js
- shared/messages.js
- storage/repository.js
- storage/indexedDbStorageAdapter.js
- 类型、消息、迁移、Repository、Worker 恢复测试
- 必要数据契约文档和路线图

明确不做：
标签、多标签页、评分、Adapter、UI 或权限。

验收：
全新 v2、完整 v1→v2、空库、重复迁移、中途失败回滚、未知版本、迁移后
查询/删除/清空/Worker 恢复。
```

### 任务 3：Session Owner 与多标签页 Active Context

```text
任务名称：实现按标签页和页面实例隔离的 Session Owner。

目标：
建立由 Background 权威确定的 Session Owner，至少包含 tabId、documentId、
frameId 和 sessionId。Content Script 不得自行伪造 tabId。

要求：
- 写消息 owner 从 chrome.runtime.MessageSender 获取。
- 只接受主 frame。
- Active Context 不再使用一个全局 current 覆盖所有标签页。
- 同一 tab 的不同 documentId 独立。
- 两个 tab 使用相同 query 仍是两个 Session。
- 一个 tab finalize 不清除另一个 tab Context。
- ACTIVE_CONTEXT_QUERY 由 B 线返回当前激活标签页 Context。
- 先验证获取当前 tab ID 是否需要新增权限；需要时停止并等待确认。
- Legacy 迁移记录继续可查，但不能伪造成当前 tab Context。

允许修改：
- shared 的 owner 类型/必要消息
- candidateDiscovery、signalsUpdate、sessionFinalize 的最小 owner 接线
- messageRouter、serviceWorker
- repository 的 owner/active-context 记录
- 对应测试和路线图

不做自动恢复、标签、评分、UI 视觉或新站点。

验收：
两个 tab、相同 query、不同 document、跨 tab 迟到消息、owner 伪造、单 tab
finalize、Worker 重启和 storage 失败。
```

### 任务 4：信号检查点与 Session 生命周期

```text
任务名称：实现低频信号检查点和持久化 Session 生命周期。

目标：
为 Session 建立 OPEN、FINALIZING、FINALIZED、ABANDONED 状态，并让发生
变化的聚合信号在浏览器强制退出前尽可能持久化。

要求：
- 检查点仍是绝对累计快照，Repository 使用字段级 Math.max 和 clicked OR。
- 信号变化后低频写入，无变化不写。
- 最大检查点间隔集中配置；先提出建议值，等待确认后实现。
- 页面隐藏、hover 结束、return、click、SPA 切换和 cleanup 结算快照。
- Service Worker 不依赖常驻 setInterval。
- pagehide/beforeunload 只作为 best-effort 优化。
- 失败后允许重试，不能永久停在 finalizing。
- 本任务不自动结算遗留 Session。

允许修改：
- 通用 Site Runtime、Bilibili 薄包装
- Session lifecycle 的共享/Repository 状态
- signals use case/Worker 最小接线
- 针对性测试和路线图

验收：
快照节流、最大延迟、乱序、重复、页面隐藏、两个 tab、写入失败、cleanup、
Worker 重启后 OPEN 状态保留。

实现记录（2026-08-28）：最大检查点间隔经确认设为 `2,000 ms`，集中在
`SITE_RUNTIME_CHECKPOINT_CONFIG`。Runtime 只发送相对最近成功确认发生变化的
绝对累计快照；失败快照保留为待重试。Session 生命周期已持久化为 `OPEN`、
`FINALIZING`、`FINALIZED`、`ABANDONED`，结算失败回退 `OPEN`，而遗留 Session
自动扫描与结算仍明确留给任务 5。
```

### 任务 5：自动恢复和可接管 Finalize

```text
任务名称：实现浏览器强制退出后的自动 Session 恢复结算。

目标：
Worker 下次被唤醒时扫描遗留 OPEN 或租约过期的 FINALIZING Session，使用
最后持久化快照自动结算。

要求：
- 使用持久化 finalizationLeaseId 和 leaseUntil，不依赖内存锁。
- 正在存活并重新注册的页面可以继续原 Session。
- 超过恢复窗口且没有对应页面实例的 Session 自动结算。
- 有有效信号的 Session 正常生成 Chosen/MissedPath。
- 没有候选或有意义信号的 Session 标记 ABANDONED。
- clicked 在恢复路径中绝不进入 Missed。
- marker、Chosen、MissedPath、状态和 Context 清理原子写入。
- 重复扫描和多个 Worker 尝试幂等。
- tabs.onRemoved 只能作为优化；如果需要权限先停止确认。
- 不使用长驻 Worker 定时器。

允许修改：
- sessionManager/sessionFinalize
- recovery coordinator（可新增）
- repository、serviceWorker 最小接线
- 恢复和事务测试
- 路线图

验收：
强制退出模拟、finalize 中途终止、租约接管、重复扫描、两 tab、空 Session、
Chosen、存储回滚、重启后不重复。

实现记录（2026-08-28）：恢复窗口暂定为 `30,000 ms`，持久化 finalize 租约
时长为 `15,000 ms`。浏览器启动扫描过期 `OPEN` 与 `FINALIZING` Session；在
Chrome 116+，普通 Worker 唤醒通过 `chrome.runtime.getContexts()` 按持久化的
`tabId + documentId + frameId` 检查精确页面实例，仍存活的页面跳过恢复，页面
消失后才结算陈旧 `OPEN`。Chrome 114–115 保留保守兼容路径：普通唤醒只接管
租约过期的 `FINALIZING`，浏览器启动仍扫描陈旧 `OPEN`。页面以原 Session
重新 discovery 会刷新活动时间并撤销尚未完成的租约。

空候选或全零信号 Session 会在同一事务中写入 `ABANDONED` 状态、durable
finalization marker 并清理对应 Active Context；其他 Session 使用最后持久化
快照原子生成 Chosen/MissedPath，clicked Candidate 始终只进入 Chosen。重复扫描、
两个 Worker 竞争、租约接管、存储回滚和重启后重试均有覆盖。未增加
`tabs`/`activeTab` 权限、Host Permission、常驻定时器或自动网络行为。

验证记录：任务 5 恢复/Worker/Repository 定向测试 59/59 通过；全仓
`npm test` 351/351 通过；`npm run typecheck` 检查 85 个 JavaScript 文件通过；
`npm run build` 的 build/release validation 通过。真实 Chrome 强制退出与
Worker 休眠/唤醒仍需按手动验收流程单独验证，不能由自动测试替代。
```

### 任务 6：Side Panel 跟随当前标签页

```text
任务名称：让 Side Panel 只展示当前激活标签页的 Context 和重逢结果。

要求：
- 当前 tab 判断来自 Background 权威状态。
- Side Panel 不读取网页 DOM、URL 或 storage。
- 标签页切换后重新查询 Active Context 和 Re-encounter。
- 使用 generation/requestId 忽略旧 tab 迟到响应。
- 无支持页面时显示明确空态，历史 MissedPath 仍可查看。
- 一个 tab 的 SHOWN/FEEDBACK 不得关联到另一个 tab Context。
- 不改变评分或视觉系统。
- 如果 tabs API 需要权限，先停止并报告。

允许修改：
- Active Context 查询/通知的最小共享消息
- Background/Worker 接线
- sidepanel/app.js
- Side Panel 测试和路线图

验收：
A/B tab 快速切换、无 Context、迟到响应、Worker 重启、查询失败、SHOWN 关联、
Side Panel 无 storage API。

实现记录（2026-08-28）：新增严格 `ACTIVE_TAB_CHANGED` 通知，只携带由
Background 提供的 `tabId`、`windowId` 和时间戳；Side Panel 不使用通知中的
标签数据计算 Context，而是在收到 `tabs.onActivated` 或窗口聚焦变化通知后
重新发送 `ACTIVE_CONTEXT_QUERY`，当前 tab 与 Context 始终由 Background
权威查询。Side Panel 复用并扩展既有本地 generation/requestId 防线，切换时
立即使旧 Context、Re-encounter、SHOWN 回调和反馈按钮失效，迟到响应不能覆盖
新标签页结果；历史 MissedPath 列表独立保留，无支持页面显示明确空态。

经 Chrome Tabs/Windows API 权限审计，本任务只监听标签激活、窗口聚焦并读取
非敏感 tab ID，不读取 URL/title/favicon，因此无需新增 `tabs`、`activeTab`
或 host 权限，`manifest.json` 未修改。任务 6 相关消息、Background、Active
Context、Worker 恢复和 Side Panel 专项回归 131/131 通过；全仓 `npm test`
356/356 通过；`npm run typecheck` 检查 86 个 JavaScript 文件通过；`npm run
build` 的 build/release validation 通过。真实 Chrome A/B 标签快速切换、
多窗口聚焦和 Worker 休眠/唤醒仍需手动验收，自动测试不替代浏览器结果。
```

### 任务 7：本地标签纯函数与共享类型

```text
任务名称：实现本地标签提取和规范化纯函数。

目标：
从搜索词和 Candidate 标题生成可解释、本地、站点无关的标签。

要求：
- Unicode、大小写和空白规范化。
- 支持中文关键词、英文 token、数字和 hashtag。
- 去重、稳定排序、长度和数量上限。
- 明确 stop words，但不建立大型 NLP 工具层。
- nativeTags 与 normalizedTags 严格分离。
- 定义 ContextTagProfile 和 CandidateTagProfile 的唯一共享 validator。
- 不访问 DOM、storage、网络、Chrome API 或模型。
- 不修改 Candidate 原字段含义。
- 空标题、空 query、噪声、重复和超长标签安全处理。

允许修改：
- shared/tags.js（可新增）
- shared/types.js
- tests/shared/tags.test.js
- tests/shared/types.test.js
- 路线图

验收：
中英文、混合文本、hashtag、大小写、去重、上限、空值、非法字段和纯函数
不变性。
```

### 任务 8：标签 Repository 与懒加载 Provider

```text
任务名称：实现标签 Profile Repository 和按需富化编排，不接真实网络。

目标：
建立统一 TagProvider 接口、标签缓存、候选资格门槛和本地 fallback。

要求：
- TagProvider 不包含站点 DOM 选择器。
- 富化门槛独立于最终 Consideration 阈值并集中配置。
- 满足 clicked、return、明显 hover、明显 exposure 或接近结算资格之一时，
  才请求原生标签。
- 同一候选并发请求合并；成功缓存；失败有退避。
- 失败使用搜索词和标题本地标签，不阻塞 finalize。
- 多个 clicked 候选形成 SessionSelectedTagProfile。
- 多个点击候选重复出现的标签获得更高频次权重。
- 无点击时 selected profile 明确为空。
- 标签按 Session Owner 隔离，删除/清空正确级联。
- 本任务只使用 fake provider，不访问真实平台。

允许修改：
- tag enrichment/provider 模块
- Repository 标签记录
- 必要共享消息/use case
- 单元和集成测试
- 路线图

不做评分、新权限、真实 API、Adapter 或 UI。
```

### 任务 9：Bilibili 原生标签权限审计与实现

```text
任务名称：为有资格的 Bilibili Candidate 获取原生视频标签。

第一阶段只读审计：
- 搜索页 DOM 是否包含可靠标签；
- 是否有公开、稳定且无需读取 Cookie/Token 的数据端点；
- 精确请求域名、请求数量、缓存和失败模式；
- 是否需要新增 host_permission。

如果需要新增或扩大权限，先输出精确域名、用途、替代方案和隐私影响，
然后停止等待用户确认，不得直接修改 Manifest。

批准后要求：
- 只为富化门槛已满足的候选请求。
- 按稳定视频 ID 去重缓存。
- 不请求正文、评论、用户资料或播放历史。
- 不读取 Cookie、Token 或页面私有变量。
- 失败退回本地标题标签。
- 不逆向签名、不绕过反爬、不增加依赖。
- 权限精确，不使用 all_urls。
- 更新 validate-build、权限文档和测试。

只修改 Bilibili TagProvider、fixture/测试、经批准 Manifest、build/privacy 文档
和路线图。不修改评分、UI、Session Manager 或第二站点。
```

### 任务 10：冻结 Consideration v2 公式（设计草案，等待用户选择）

**当前事实**：
- 任务 7/8 已就绪：`ContextTagProfileV1`、`CandidateTagProfileV1`、`SessionSelectedTagProfileV1` 已持久化，按 Session Owner 隔离；
- 任务 9 审计结果：Bilibili 搜索卡片 DOM 无稳定可见的原生视频标签，当前只使用标题/搜索词本地 fallback；
- 当前 P0 公式（`background/consideration.js`）：
  ```text
  C = 0.30 × exposure + 0.30 × hover + 0.25 × returnView + 0.15 × repeatedHover
  threshold = 0.55
  clicked=true → EXCLUDED_CLICKED, score=0
  ```
- 归一化上限（`background/scoringConfig.js`）：
  ```text
  exposureMs = 10_000, hoverMs = 3_000, returnCount = 2, repeatedHoverCount = 3
  ```
- `selected_tag_similarity` 需要 `SessionSelectedTagProfileV1.tags`（每项含 `tag`、`candidateCount`、`weight`）与当前 Candidate 的 `CandidateTagProfileV1.normalizedTags` 计算契合度。

---

#### 方案 A：保守加法（推荐）

**公式**：
```text
behaviorScore = 0.30 × exposure + 0.30 × hover + 0.25 × returnView + 0.15 × repeatedHover
selected_tag_similarity = Jaccard(candidate.normalizedTags, sessionSelected.normalizedTags)
                          若 selectedCandidateCount = 0 则取 0

tagBonus = selected_tag_similarity × 0.15

totalScore = behaviorScore + tagBonus

最低行为门槛：behaviorScore ≥ 0.35（独立于总阈值）
总阈值：totalScore ≥ 0.55
```

**无 clicked 候选时的 fallback**：
- `SessionSelectedTagProfileV1.selectedCandidateCount = 0`，`tags = []`；
- `selected_tag_similarity = 0`，`tagBonus = 0`；
- 不归一化，总分上限从 1.0 降至 0.85（行为满分 1.0 × 1.0，标签满分 1.0 × 0.15）。

**平台/layout caps 建议**（归一化上限，集中配置）：
```text
BILIBILI / GRID:
  exposureMs = 10_000, hoverMs = 3_000, returnCount = 2, repeatedHoverCount = 3
ZHIHU / TEXT_LIST:
  exposureMs = 15_000, hoverMs = 5_000, returnCount = 3, repeatedHoverCount = 4
DOUYIN / VIDEO_FEED:
  exposureMs = 8_000, hoverMs = 2_000, returnCount = 2, repeatedHoverCount = 3
```

**Reason codes**（保持现有 4 个行为 reason + 1 个标签 reason）：
- `LONG_EXPOSURE`、`LONG_HOVER`、`RETURN_VIEW`、`REPEATED_HOVER`（贡献 = normalized × 行为权重）
- `SELECTED_TAG_SIMILARITY`（贡献 = selected_tag_similarity × 0.15）
- `NOT_CLICKED`（贡献 = 0，占位）

**优点**：
- 标签权重 15%，在 10%～20% 范围内，且不是最高单项（0.30 > 0.25 > 0.15）；
- 标签不能单独产生 MissedPath（必须 behaviorScore ≥ 0.35）；
- 无点击时标签项为零，公式仍一致，无需特殊分支；
- 可解释性强：Jaccard 相似度是纯文本集合相似度，无黑盒；
- 与现有 P0 公式兼容，迁移成本低。

**缺点/误判风险**：
- 同一会话若只有一个 clicked 候选，`SessionSelectedTagProfileV1` 可能只含 1～2 个标签，Jaccard 容易为 0 或 1，区分度有限；
- Bilibili 网格布局下，同一行卡片共同曝光可能导致多个候选的 `behaviorScore` 同时超过 0.35，标签项也无法有效区分；
- 尚未通过 5～10 人用户测试校准，0.35 行为门槛和 0.15 标签权重是暂定值。

**测试矩阵**：
- clicked=true → 永远 EXCLUDED_CLICKED，score=0；
- behaviorScore < 0.35 → 无论标签相似度多高，classification = BELOW_THRESHOLD；
- behaviorScore ≥ 0.35 且 totalScore < 0.55 → BELOW_THRESHOLD；
- behaviorScore ≥ 0.35 且 totalScore ≥ 0.55 → QUALIFIES；
- selectedCandidateCount = 0 → tagBonus = 0；
- Jaccard = 0 / 1 边界；
- 不同 platform/layout caps 下的归一化结果；
- 重复 finalize / 恢复 finalize 幂等性。

---

#### 方案 B：加权平均（标签占 10%）

**公式**：
```text
behaviorScore = 0.32 × exposure + 0.32 × hover + 0.23 × returnView + 0.13 × repeatedHover
selected_tag_similarity = Jaccard(candidate.normalizedTags, sessionSelected.normalizedTags)
                          若 selectedCandidateCount = 0 则取 0

totalScore = 0.90 × behaviorScore + 0.10 × selected_tag_similarity

最低行为门槛：behaviorScore ≥ 0.40
总阈值：totalScore ≥ 0.55
```

**无 clicked 候选时的 fallback**：
- `selected_tag_similarity = 0`；
- `totalScore = 0.90 × behaviorScore`；
- 总分上限从 1.0 降至 0.90。

**平台/layout caps 建议**：同方案 A。

**Reason codes**：
- 行为 4 项（贡献 = normalized × 行为权重 × 0.90）
- `SELECTED_TAG_SIMILARITY`（贡献 = selected_tag_similarity × 0.10）
- `NOT_CLICKED`（贡献 = 0）

**优点**：
- 标签权重 10%，更保守；
- 加权平均形式更直观：行为占 90%，标签占 10%。

**缺点/误判风险**：
- 行为权重总和从 1.0 降至 0.90，需要重新校准阈值；
- 无点击时总分上限降至 0.90，0.55 阈值相当于原来的 0.55/0.90 ≈ 0.61，行为门槛需相应提高；
- 解释成本略高：用户需要理解"为什么我的 behaviorScore 很高但总分不够"。

**测试矩阵**：同方案 A，增加：
- behaviorScore = 1.0, selected_tag_similarity = 0 → totalScore = 0.90；
- behaviorScore = 0.40, selected_tag_similarity = 1.0 → totalScore = 0.46（低于 0.55，验证行为门槛）。

---

#### 方案 C：行为门槛 + 标签加成（标签占 20%，但有上限）

**公式**：
```text
behaviorScore = 0.30 × exposure + 0.30 × hover + 0.25 × returnView + 0.15 × repeatedHover
selected_tag_similarity = Jaccard(candidate.normalizedTags, sessionSelected.normalizedTags)
                          若 selectedCandidateCount = 0 则取 0

tagBonus = min(0.20, selected_tag_similarity × 0.20)

totalScore = behaviorScore + tagBonus

最低行为门槛：behaviorScore ≥ 0.40（比方案 A 更高）
总阈值：totalScore ≥ 0.60（比方案 A 更高）
```

**无 clicked 候选时的 fallback**：
- `tagBonus = 0`；
- `totalScore = behaviorScore`；
- 阈值 0.60 只靠行为分达到，门槛更高。

**平台/layout caps 建议**：同方案 A。

**Reason codes**：同方案 A。

**优点**：
- 标签权重上限 20%，在允许范围内；
- 行为门槛 0.40 更高，降低网格共同曝光误判；
- 总阈值 0.60 更高，MissedPath 数量会更少但质量更高。

**缺点/误判风险**：
- 行为门槛 0.40 较高，可能导致部分认真考虑但未达门槛的候选被漏掉；
- 总阈值 0.60 需要更多用户测试校准；
- 无点击时标签项为零，用户可能疑惑"为什么没有标签加成"。

**测试矩阵**：同方案 A，增加：
- behaviorScore = 0.39 → 无论标签多高，BELOW_THRESHOLD；
- behaviorScore = 0.40, selected_tag_similarity = 0 → totalScore = 0.40 < 0.60 → BELOW_THRESHOLD；
- behaviorScore = 0.40, selected_tag_similarity = 1.0 → totalScore = 0.60 → QUALIFIES（边界）。

---

#### 推荐方案：**方案 A（保守加法）**

**理由**：
- 标签权重 15%，在 10%～20% 中间值，既不过分保守也不激进；
- 行为门槛 0.35 相对温和，减少漏掉认真考虑候选的风险；
- 总阈值 0.55 与现有 P0 一致，迁移成本低；
- 无点击时标签项为零，公式一致，无需特殊解释；
- 可解释性最强，适合比赛答辩。

**待用户批准的具体值**：
- 行为权重：exposure 0.30, hover 0.30, returnView 0.25, repeatedHover 0.15；
- 标签权重：0.15；
- 最低行为门槛：0.35；
- 总阈值：0.55；
- 无点击 fallback：`selected_tag_similarity = 0`，不归一化；
- 平台 caps：
  - BILIBILI / GRID: exposureMs=10000, hoverMs=3000, returnCount=2, repeatedHoverCount=3；
  - ZHIHU / TEXT_LIST: exposureMs=15000, hoverMs=5000, returnCount=3, repeatedHoverCount=4；
  - DOUYIN / VIDEO_FEED: exposureMs=8000, hoverMs=2000, returnCount=2, repeatedHoverCount=3；
- Reason codes：`LONG_EXPOSURE`、`LONG_HOVER`、`RETURN_VIEW`、`REPEATED_HOVER`、`SELECTED_TAG_SIMILARITY`、`NOT_CLICKED`。

**明确限制**：
- 上述参数状态为 `UNVALIDATED_PENDING_5_TO_10_PERSON_TEST`；
- 尚未进行 5～10 人用户测试校准；
- Bilibili 当前无原生标签，`selected_tag_similarity` 只依赖本地标题/搜索词标签；
- 网格共同曝光问题只能部分缓解，不能完全消除。

---

### 6.8 任务 10 完成记录（2026-08-29）—— Consideration v2 公式已冻结

**用户已批准方案 A（保守加法）**，参数冻结如下：

**行为权重**：
```text
exposure = 0.30
hover = 0.30
returnView = 0.25
repeatedHover = 0.15
```

**标签权重**：
```text
selected_tag_similarity_weight = 0.15
```

**阈值与门槛**：
```text
最低行为门槛 = 0.35（behaviorScore 必须 ≥ 0.35 才能进入 MissedPath 候选）
总阈值 = 0.55（totalScore = behaviorScore + tagBonus ≥ 0.55 才判定为 QUALIFIES）
```

**无点击 fallback**：
```text
若 SessionSelectedTagProfileV1.selectedCandidateCount = 0：
  selected_tag_similarity = 0
  tagBonus = 0
  totalScore = behaviorScore
  不归一化，总分上限从 1.0 降至 0.85
```

**不变量**：
```text
- clicked = true → 永远 EXCLUDED_CLICKED，score = 0
- 标签不能单独或绕过最低行为门槛生成 MissedPath（必须 behaviorScore ≥ 0.35）
- selected_tag_similarity = Jaccard(candidate.normalizedTags, sessionSelected.normalizedTags)
  若 selectedCandidateCount = 0 则取 0
- tagBonus = selected_tag_similarity × 0.15
```

**平台/layout 归一化 caps（集中配置）**：
```text
BILIBILI / GRID:
  exposureMs = 10_000
  hoverMs = 3_000
  returnCount = 2
  repeatedHoverCount = 3

ZHIHU / TEXT_LIST:
  exposureMs = 15_000
  hoverMs = 5_000
  returnCount = 3
  repeatedHoverCount = 4

DOUYIN / VIDEO_FEED:
  exposureMs = 8_000
  hoverMs = 2_000
  returnCount = 2
  repeatedHoverCount = 3
```

**Reason codes**：
```text
LONG_EXPOSURE      → 贡献 = normalized.exposure × 0.30
LONG_HOVER         → 贡献 = normalized.hover × 0.30
RETURN_VIEW        → 贡献 = normalized.returnView × 0.25
REPEATED_HOVER     → 贡献 = normalized.repeatedHover × 0.15
SELECTED_TAG_SIMILARITY → 贡献 = selected_tag_similarity × 0.15
NOT_CLICKED        → 贡献 = 0（占位）
```

**明确限制**：
- 上述参数状态为 `UNVALIDATED_PENDING_5_TO_10_PERSON_TEST`；
- 尚未进行 5～10 人用户测试校准；
- Bilibili 当前无原生标签，`selected_tag_similarity` 只依赖本地标题/搜索词标签；
- 网格共同曝光问题只能部分缓解，不能完全消除。

**任务 10 状态**：COMPLETED（设计冻结）
**下一步**：任务 11（实施 Consideration v2）—— 需按上述冻结参数实施，不得猜测或修改。

### 6.9 任务 11 完成记录（2026-08-29）—— Consideration v2 已实施

**修改文件**：
- `background/scoringConfig.js`：添加 `weights.selectedTagSimilarity=0.15`、`minimumBehaviorThreshold=0.35`、平台特定 `normalizationCapsByPlatform`、导出 `getNormalizationCapsForCandidate()`；
- `background/consideration.js`：新增 `jaccardSimilarity()` 纯函数、重写 `calculateConsideration(signals, context)` 支持 `selected_tag_similarity`、最低行为门槛检查、`SELECTED_TAG_SIMILARITY` reason code；
- `background/sessionManager.js`：在 `finalizeSession` 中读取 `SessionSelectedTagProfile` 并传给 `calculateConsideration`；
- 新增 `tests/background/consideration.test.js`（23 个测试）。

**实现内容**：
- `calculateConsideration(signals, context)` 现在接受可选 `context` 参数（含 `candidate` 和 `sessionSelectedTagProfile`）；
- 计算 `behaviorScore`（4 项行为 × 对应权重）；
- 计算 `selectedTagSimilarity`（Jaccard 相似度，候选 normalizedTags 与 sessionSelectedTagProfile.tags 的交集/并集）；
- `tagBonus = selectedTagSimilarity × 0.15`；
- 若 `behaviorScore < 0.35` 直接返回 `BELOW_THRESHOLD`（标签不能绕过最低行为门槛）；
- `totalScore = behaviorScore + tagBonus`，与 0.55 阈值比较；
- 新增 `SELECTED_TAG_SIMILARITY` reason code（仅在相似度>0 时出现）；
- `getNormalizationCapsForCandidate(candidate)` 根据 platform/layoutType 返回不同 caps，缺失时回退到 BILIBILI/GRID。

**不变量**：
- `clicked=true` → 永远 `EXCLUDED_CLICKED`，score=0；
- 标签不能单独或绕过最低行为门槛（必须 behaviorScore ≥ 0.35）；
- 无点击时 `SessionSelectedTagProfile.selectedCandidateCount=0` → `selectedTagSimilarity=0`，tagBonus=0；
- 重复 finalize / 恢复 finalize 结果一致（纯函数不变性）。

**测试覆盖**：
- 配置值验证（行为权重、标签权重 0.15、最低行为门槛 0.35、总阈值 0.55、平台 caps）；
- `getNormalizationCapsForCandidate` 平台回退逻辑；
- clicked=true 排除；
- behaviorScore < 0.35 被拒绝（即使标签相似度=1）；
- behaviorScore ≥ 0.35 且 totalScore ≥ 0.55 → QUALIFIES；
- 无点击 fallback（selectedTagSimilarity=0）；
- Jaccard 相似度 0/1 边界；
- reason codes 完整性；
- 不同平台 caps 归一化结果；
- 幂等性（重复调用、乱序 signals）。

**验证**：
- consideration 专项测试：23/23 通过；
- 全仓 `node --test` 与 `npm test`：444/444 通过（基线 431 + 新增 13 个 consideration 测试）；
- `npm run typecheck`：94 个 JavaScript 文件通过；
- `npm run build`：build + release validation 通过；
- `git diff --check`：通过。

**明确限制**：
- 参数状态仍为 `UNVALIDATED_PENDING_5_TO_10_PERSON_TEST`；
- Bilibili 当前无原生标签，`selected_tag_similarity` 只依赖本地标题/搜索词标签；
- 网格共同曝光问题只能部分缓解，不能完全消除。

**任务 11 状态**：COMPLETED（实施完成）
**下一步**：任务 12（跨平台 Re-encounter v2）—— 保留 prior consideration、freshness、cooldown、repeated dismissal，加入历史 Candidate 标签与当前 Context 标签契合度。

### 任务 11：实施 Consideration v2

```text
任务名称：实施用户已经批准的 Consideration Score v2。

开始前从路线图读取已批准的精确权重、阈值、行为最低门槛和 caps；没有
明确批准值时停止，不得猜测。

要求：
- 先实现和测试纯函数。
- clicked 永远排除。
- selected_tag_similarity 使用批准的中低权重。
- 没有点击时使用批准的 fallback。
- 标签不能绕过最低行为门槛。
- 平台/layout caps 集中在 scoringConfig。
- Session finalize 从 Repository 获取权威 TagProfile。
- 标签请求失败仍能用 fallback 结算。
- reasons 包含贡献但不暴露敏感数据。
- 重复 finalize 与恢复 finalize 结果一致。
- 不修改 Re-encounter。

允许修改 consideration、scoringConfig、sessionManager 最小接线、标签查询
用例、纯函数/Session/恢复测试和路线图。
```

### 任务 12：跨平台 Re-encounter v2

```text
任务名称：实现标签增强的跨平台 Re-encounter 评分。

要求：
- 保留 prior consideration、freshness、cooldown、repeated dismissal。
- 加入历史 Candidate 标签与当前 Context 标签契合度。
- 当前 Session 已有点击时，可加入 selected tag profile 契合度。
- 当前 Session 无点击时只使用 Context 标签。
- 不因同平台自动给予决定性加分。
- 原平台、内容类型和 URL 保持不变。
- 最多返回 1～3 条，稳定 tie-break。
- SHOWN、LATER、NOT_RELEVANT、OPENED 语义保持。
- 标签缺失时退回现有关键词/Jaccard。
- reasons 说明搜索词匹配、标签匹配、历史考虑、冷却和负反馈。
- 不使用模型或 Embedding。

只修改 reencounter、scoringConfig、query use case、必要标签读取、纯函数与
集成测试和路线图；不修改 Adapter、权限或 UI 布局。
```

### 6.10 任务 12 完成记录（2026-08-29）—— 跨平台 Re-encounter v2

**用户批准的方案 A**：

```text
R = 0.45 × keywordContextSimilarity
  + 0.15 × tagSimilarity
  + 0.25 × priorConsideration
  + 0.15 × freshness
  - cooldownPenalty
  - repeatedDismissalPenalty
threshold = 0.60, result limit = 1..3
```

- `tagSimilarity` 以历史 `CandidateTagProfile` 对当前 `ContextTagProfile` 的
  Jaccard 相似度为主；当前 Session 存在已点击候选时，按 `0.75 × Context 标签
  相似度 + 0.25 × SessionSelectedTagProfile 相似度` 计算，否则只使用 Context
  标签；
- 历史 Candidate 或当前 Context 标签缺失/为空时，标签贡献为 0，继续使用原有
  搜索词/关键词 Jaccard 路径，不把关键词重复计算成标签奖励；
- 在关键词完全无重叠时，即使标签、历史考虑和新鲜度均为 1，最高分也只有
  `0.55`，低于 `0.60` 阈值，因此标签本身不能成为决定性证据；
- 当前标签页 ID 由 Background 查询，Side Panel 不发送 owner；Query Use Case
  通过当前 Active Context 的 owner 读取 Context/Selected Profile。历史
  Candidate Profile 由 MissedPath 的稳定结果 ID 在 Repository 内部还原，未向
  MissedPath DTO 增加 owner，也未升级 schema；
- `CANDIDATE_CHOSEN` 成功后 best-effort 刷新当前 Session 的 Selected Tag
  Profile；标签刷新失败不回滚或阻塞权威点击信号；
- 未加入同平台奖励，返回 DTO 保留原 Candidate 的 `source`、`contentType`、
  `layoutType` 和 URL；原有 30 天 freshness、24 小时 cooldown、重复负反馈惩罚、
  1～3 条限制和 MissedPath ID 稳定 tie-break 不变；
- `SHOWN`、`LATER`、`NOT_RELEVANT`、`OPENED` 的消息和 Repository 语义未修改；
- reasons 使用中文分别说明搜索词、标签、历史考虑、新鲜度、冷却与负反馈；
- 无模型、Embedding、网络、依赖、权限、Adapter 或 Side Panel 布局变化。

**验证**：

- Re-encounter、Query、Router、消息、Repository 与 Worker 恢复专项测试通过；
- 全仓 `node --test` 与 `npm test`：449/449 通过；
- `npm run typecheck`：94 个 JavaScript 文件通过；
- `npm run build`：build + release validation 通过；
- `git diff --check`：通过。

**明确限制**：权重、阈值、时间窗口和惩罚仍标记为
`UNVALIDATED_PENDING_5_TO_10_PERSON_TEST`；Bilibili 当前只有标题/搜索词本地
fallback，尚未获得原生平台标签。

**任务 12 状态**：COMPLETED

**下一步**：任务 13（知乎 Adapter 与 Runtime）；开始前必须先确认精确知乎搜索
URL、content-script match 和 host permission。

### 任务 13：知乎 Adapter 与 Runtime

```text
任务名称：实现知乎搜索页 Adapter，支持问题、回答和文章。

开始前确认精确知乎搜索 URL、content-script match 和 host permission；未确认
时先报告并等待批准。

要求：
- 使用通用 Site Runtime、binding 和 collectors。
- 选择器只在 Zhihu Adapter。
- 区分 QUESTION、ANSWER、ARTICLE。
- 使用稳定、带平台命名空间的 Candidate ID。
- 规范化永久 URL。
- 只提取标题、最小来源、排名、sessionId 和 DOM 可见最小标签。
- 回答可使用问题标题展示，但 URL 必须指向具体回答。
- 不保存回答正文、摘要全文、用户资料或评论。
- 支持初始结果、动态加载、SPA 搜索词切换、去重和 cleanup。
- 广告、用户、无稳定 URL 和异常卡片跳过。
- 原生标签缺失时使用本地 fallback。
- 不影响 Demo/Bilibili。

允许修改 Zhihu Adapter/fixture/测试、registry/content entry、通用 Runtime 的
必要兼容、经批准 Manifest、validate-build 和路线图。

验收包括点击方式、多标签页、恢复结算和真实 Chrome 手动检查。
```

#### 任务 13 完成记录（2026-08-29）

- 已确认真实搜索入口为 `https://www.zhihu.com/search?type=content&q=<query>`，
  hostname 为 `www.zhihu.com`；搜索提交会产生已提交的新文档导航，结果列表支持
  动态追加与节点替换；
- 已批准并实现精确 content-script match `https://www.zhihu.com/search*`，以及仅供
  该页面加载本地模块的 web-accessible resource match `https://www.zhihu.com/*`；
  未新增 Zhihu host permission；
- 已实现 QUESTION、ANSWER、ARTICLE 三类 Candidate；回答 URL 指向具体回答，文章
  URL 指向知乎专栏永久地址；ID 使用 `zhihu:<contentType>:<stableId>` 命名空间；
- Adapter 只读取标题、稳定链接和最小结构标记，跳过广告、用户、无永久 URL、空标题
  和异常卡片；未读取正文、完整摘要、用户资料、评论、Cookie 或 Token；
- 已复用通用 Site Runtime、Candidate binding、visibility/hover/click collectors、
  Session 检查点与恢复结算；Demo 与 Bilibili 接线保持不变；
- 真实页面只读审计确认 AnswerItem、PostItem 与问题 Content 卡片可由稳定链接识别；
  两次滚动时结果节点数从 24 增至 44、再增至 64；当前页面没有稳定可复用的原生标签，
  因而保留本地 fallback；
- 自动验证：全仓 `node --test` / `npm test` 466/466 通过，`npm run typecheck`
  检查 101 个 JavaScript 文件通过，`npm run build` 的 build/release validation 通过，
  `git diff --check` 通过；
- 真实 Chrome unpacked extension 手动验收尚未执行。内置浏览器的已登录页面审计只证明
  当前 DOM 与交互事实，不替代扩展 Content Script、点击采集、多 tab owner 与恢复流程的
  Chrome 手动验证。

**任务 13 状态**：COMPLETED（实现、自动测试与文档）；真实 Chrome 手动验收：PENDING。

**下一步**：任务 14（知乎原生标签增强）；本任务完成后不得自动开始。

### 任务 14：知乎原生标签增强

```text
任务名称：只实现知乎问题、回答和文章的按需原生标签富化。

先只读审计知乎搜索 DOM 和公开数据来源。需要新权限时停止确认。

要求：
- 只对达到富化门槛的 Candidate 请求。
- 优先使用页面已有话题/标签。
- 不抓取完整回答或文章正文。
- 不读取登录 Cookie、Token 或私有页面状态。
- 需要登录、签名或不稳定私有接口时放弃原生数据，使用本地 fallback。
- 问题、回答、文章使用统一 TagProfile。
- 缓存、并发去重、退避和删除级联复用现有模块。

不修改评分、Side Panel 或其他站点。
```

#### 任务 14 审计与 fallback 完成记录（2026-08-29）

- 在已登录的真实知乎搜索页检查 QUESTION、ANSWER、ARTICLE 使用的语义卡片边界；
  当前样本的 19 个结果模块中没有任何可见 `/topic/` 链接或 Tag/Topic 元素；
- QUESTION 与 ANSWER 详情页能看到 `TopicLink`，ARTICLE 详情页能看到
  `TopicList Post-Topics`/`TopicLink`，但这些标签不在搜索卡片 DOM 中；
- 不带 Cookie/Token 的详情页 HEAD 请求返回 403；候选级
  `/api/v4/.../topics` 路径返回 404；知乎官方数据开放平台要求 Bearer 凭据；
- 因此没有符合“只取标签、不取正文、无需登录/签名/密钥”的稳定公开来源。按照任务
  冻结边界，不抓取详情页 HTML、不读取登录 Cookie/Token、不接开放平台密钥；
- 生产 `TagProvider` 明确保留为 `null`，不新增知乎 host permission 或网络请求；
  达到任务 8 门槛的 Candidate 继续由同一个 Coordinator 生成并持久化标题/搜索词
  `LOCAL_FALLBACK` TagProfile；QUESTION、ANSWER、ARTICLE 不创建第二套类型；
- 门槛、每会话上限、缓存/并发合并/退避、两 tab Owner 隔离、Worker 重启读取、暂停、
  删除与清空均复用任务 8 已有实现，不修改评分、Side Panel、Bilibili 或抖音；
- 专项回归 60/60 通过；全仓 `node --test` 与 `npm test` 467/467 通过；
  `npm run typecheck` 检查 101 个 JavaScript 文件通过；`npm run build` 的
  build/release validation 通过；
- 内置浏览器完成了标签来源审计；加载 unpacked extension 的真实 Chrome Network/
  IndexedDB 手动确认仍待执行，不能由自动测试替代。

**任务 14 状态**：PARTIAL（隐私安全的审计与 fallback 路径 COMPLETED；没有声称已取得
知乎原生标签，原生 Provider 未实现）。

**下一步**：任务 15（抖音 Adapter 与 Runtime）；本任务完成后不得自动开始。

### 任务 15：抖音 Adapter 与 Runtime

```text
任务名称：实现抖音搜索页 Adapter，支持普通视频和图文作品。

开始前确认精确抖音搜索 URL、内容类型 DOM 和 host permission。目标页面必须
登录或结构无法稳定识别时先报告，不得绕过登录或反爬。

要求：
- 只支持 VIDEO 和 IMAGE_POST。
- 排除用户、话题、直播、商品和广告。
- 使用通用 Site Runtime 和 collectors。
- 选择器只在 Douyin Adapter。
- 使用稳定、带平台命名空间的 ID 和永久 URL。
- 不读取视频内容、图文正文、评论、用户资料、Cookie 或 Token。
- 支持初始结果、动态加载、SPA 切换、重复节点和 cleanup。
- 区分列表/网格与大卡片布局，只提供 layoutType，不在 Adapter 评分。
- DOM 可见 hashtag 可作为 nativeTags，缺失时使用标题/搜索词 fallback。
- 所有点击方式不阻止默认导航。
- 不影响 Demo、Bilibili、知乎。

允许修改 Douyin Adapter/fixture/测试、registry/content entry、通用 Runtime 的
必要兼容、经批准 Manifest、validate-build 和路线图。
```

### 任务 16：抖音原生标签增强

```text
任务名称：只实现抖音视频和图文作品的按需原生标签富化。

先只读判断搜索卡片中可见 hashtag 是否已经足够。

要求：
- 优先使用 DOM 可见 hashtag。
- 只有达到富化门槛才尝试额外数据源。
- 不逆向签名参数，不读取 Cookie/Token，不调用要求模拟客户端的接口。
- 公开稳定端点不可用时，使用 DOM hashtag + 本地标题标签，不算失败。
- 缓存、去重、退避和 fallback 复用共享 TagProvider。
- 不支持用户、话题、直播、商品或广告。

需要新增权限时先停止并请求精确批准。不修改评分、Repository 结构或其他
Adapter。
```

### 任务 17：最终三平台集成与发布验收

```text
任务名称：对 The Unclicked v2 三平台候选版本做最终集成和只读验收。

以代码为事实，检查路线图每个 COMPLETED 项是否有真实实现和测试。不得把
fixture、mock 或静态 prototype 算作真实运行时闭环。

追踪：
A. Bilibili/知乎/抖音 → Adapter → 通用 Runtime → Session Owner；
B. visibility/hover/return/click → 检查点 → Repository；
C. 本地标签/原生 Provider → TagProfile；
D. 多点击标签画像 → Consideration v2 → Chosen/Missed；
E. 当前激活 tab → Re-encounter v2 → SHOWN/FEEDBACK；
F. 强制退出 → 自动恢复 → 幂等 finalize；
G. 暂停、单删、清空 → 所有平台最终状态。

检查三 tab、相同 query、快速切 tab、迟到响应、强制退出、finalize 中断、
clicked 排除、标签 fallback、跨平台重逢、最多三条、冷却、负反馈、精确
权限、敏感数据、旧 v1 迁移、文档/视频/截图和公开仓库隐私。

运行所有语法检查、node --test、npm test、typecheck、build。npm 不可用时
运行底层命令并明确区分。

输出可提交/有条件可提交/不可提交、P0/P1/P2、自动验证矩阵、三平台 Chrome
手动矩阵、权限表、迁移结果、未验证行为和最小修复顺序。

本任务只读，不修改、提交、推送、打 tag 或打包。
```

## 12. 每项任务完成报告模板

```text
任务编号与名称：
开始 HEAD：
结束时工作树状态：

实际完成：
-

修改文件：
-

未修改/明确不做：
-

执行命令：
-

测试结果：
- 语法检查：
- 专项测试：
- node --test：
- npm test：
- typecheck：
- build：

权限或网络变化：
-

兼容与迁移：
-

已知限制：
-

下一项允许开始的任务：
-
```

## 13. 发布前仍需注意的已有问题

- 当前公开仓库的“开发起点证明”图片曾被审计发现包含本机绝对路径和账号名；如果仍未处理，发布审计应继续将其列为隐私风险。
- 当前评分参数尚未经过 5～10 人用户测试，不能声称已经验证准确性。
- 平台 DOM 会变化，自动测试不能替代真实 Chrome 手动验收。
- Bilibili、知乎、抖音的网页条款、接口可用性和登录限制需要在实际接入时重新确认。
- 不得声称支持所有搜索引擎、所有站内页面或语义 AI 理解。
