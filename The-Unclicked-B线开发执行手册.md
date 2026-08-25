# The Unclicked（余路）B 线开发执行手册

> 适用周期：2026-08-22 至 2026-08-31 24:00  
> 当前执行起点：2026-08-23  
> 角色：工作线 B（浏览器扩展核心、数据与集成）  
> 执行原则：冻结范围、local-first、Manifest V3、Side Panel、本地 Demo 优先、一次只做一个任务

## 1. B 线真正负责什么

B 线的核心目标是：始终维护一个可安装、可运行、可回退、可演示的版本，让数据稳定地从页面流到 Side Panel。

B 线主责：

1. 建立和维护代码仓库、Chrome Manifest V3 扩展骨架、构建与测试命令。
2. 让 Side Panel 能打开，并建立 Content Script、Service Worker、Side Panel 之间的消息连接。
3. 建立本地可控 Demo 搜索页及其 Site Adapter。
4. 识别候选结果，采集并聚合曝光、hover、回看、滚动返回和点击。
5. 定义检索会话，计算可解释的 Consideration Score。
6. 将点击项归入 Chosen Path，将高分未点击项结算为 Missed Path。
7. 使用简单、可解释的 P0 上下文匹配触发一次 Re-encounter。
8. 提供打开、稍后/忽略、不相关、删除、暂停和清空数据的后端处理。
9. 维护本地存储、数据删除、版本迁移和 Service Worker 休眠后的恢复。
10. 接入一个真实站点 Adapter，修复重复记录、点击漏判和动态页面问题。
11. 负责技术 README、安装/构建说明、权限与隐私说明、可安装包和稳定版本。
12. 每天向 A 线提供可运行版本、样例数据、接口说明和当前最大技术风险。

B 线协助但不是主责：

- 向 A 线提供稳定的 `MissedPath`、`Reencounter`、`Settings` 等数据接口。
- 与 A 线共同完成 Demo 联调、用户测试观察、视频录制和最终检查。
- 检查项目简介、截图和视频中的技术表述是否与代码一致。

B 线不要接管：

- Side Panel 的视觉打磨、用户文案、项目简介和视频叙事由 A 线主责。
- 不为了“技术含量”增加后端、账号、云同步、大模型、Embedding、第二站点或复杂可视化。
- 不让评分、存储或业务状态耦合 UI。

## 2. 不得改变的冻结决策

每次让 AI 写代码前，都要提供下面的硬约束：

1. 产品形态是 Chrome Manifest V3 浏览器扩展，主要 UI 是 Side Panel。
2. 首要场景是学生/科研人员在搜索或知识检索页筛选资料。
3. 核心对象是“认真考虑但最终没有选择”的候选，不是全部浏览历史。
4. 核心输出是 Missed Path，以及未来相关情境中的 Contextual Re-encounter。
5. 默认 local-first；不上传完整浏览历史。
6. MVP 不依赖大模型也必须完整运行；AI/Embedding 只能是可选增强层。
7. 所有评分必须可解释，界面和路演不得声称读取思想或真实注意力。
8. 重新出现必须少量、克制、可关闭、可删除，并有冷却和重复忽略惩罚。
9. Demo 必须有本地可控路径，不依赖真实站点、网络、收费 API、临时密钥或真实等待数天。
10. 先跑通本地闭环，再接一个真实站点；只允许一个真实站点进入比赛 MVP。
11. 权限最小化；新增 host permission、依赖、外部服务或数据上传前必须由两人确认。
12. 一次只完成一个边界明确的变更，不顺手重构。

禁止采集：

- 键盘输入、表单值、密码字段；
- Cookie、认证 Token；
- 完整页面正文；
- 完整鼠标轨迹或高频 mousemove 数据；
- 默认敏感站点和隐身模式中的行为。

## 3. B1～B10 任务和节点

| 顺序 | 最晚时间 | B 线任务 | 完成标志 |
|---|---:|---|---|
| B1 | 8/22 | 仓库与扩展骨架 | 扩展可安装、Side Panel 可打开、有第一条 commit |
| B2 | 8/23 | 本地 Demo Adapter | 能提取候选标题、URL、位置、ID；动态结果不重复 |
| B3 | 8/23 | 基础事件聚合 | 调试数据能显示曝光、hover、回看、点击的聚合值 |
| B4 | 8/25 | Missed Path | 已点击排除；高分未点击项稳定保存为 Missed |
| B5 | 8/26 | 重逢触发 | 相关上下文可复现一次重逢，并支持反馈 |
| B6 | 8/27 | 一个真实站点 Adapter | 真实页可识别候选和点击；选择器只在 Adapter |
| B7 | 8/28 | 测试与修复 | 重复、误判、休眠与重启恢复等核心用例通过 |
| B8 | 8/29 | 发布与技术说明 | 陌生人按 README 可安装、构建和体验 |
| B9 | 8/30 | 稳定版本 | 有可回退 tag/压缩包，只修演示阻塞问题 |
| B10 | 8/31 | 提交检查 | 公开源码、构建、安装包完整且无密钥泄露 |

共同里程碑：

- 8/24 中期指导前：项目方向、工程起点和风险清楚。
- 8/27 晚：可安装扩展 + 本地 Demo + Missed Path + 一次重逢全部跑通。
- 8/30 中午：功能冻结，只修演示/提交阻塞问题。
- 8/31 18:00：形成可提交版本，预留 6 小时检查上传与链接。

## 4. 从 8/23 开始的逐日开发路线

WIP 限制：你同一时间只能有一个主开发任务。当前任务没有通过验收，不进入下一项。

### 8/23：补齐 B1，完成 B2 与 B3

#### 任务 1：只确认扩展骨架

如果 8/22 尚未完成，先补齐：

- 仓库和第一条 commit；
- `manifest.json` 使用 Manifest V3；
- Service Worker 入口；
- Side Panel 入口；
- Content Script 或 Demo Adapter 入口；
- 共享类型、消息、存储抽象的最小空壳；
- 本地 Demo 页。

验收：加载 unpacked extension 无报错；Side Panel 可打开；页面、后台和 Side Panel 能完成一次最小 ping/pong；保存起点截图或短录屏。

不要做：评分、真实站点、复杂 UI、模型或云端。

#### 任务 2：只实现 Adapter 接口与本地 Demo Adapter

建议最小接口：

```ts
export interface SiteAdapter {
  canHandle(url: URL, document: Document): boolean;
  getContext(document: Document, url: URL): SearchContext;
  extractCandidates(document: Document): Candidate[];
  observeChanges(onCandidatesChanged: () => void): () => void;
}
```

要求：

- DOM 选择器只存在于 `content/adapters/`。
- Candidate 至少包含稳定 ID、规范化 URL、标题、来源、排名和 sessionId。
- 动态新增结果能被发现，但同一候选不重复注册。
- Adapter 不评分、不存储、不操作 Side Panel。

验收：本地 Demo 首次加载与动态新增结果都能输出 Candidate；URL 规范化与去重有测试。

#### 任务 3：按小步骤实现聚合事件

依次完成，不要一次全部生成：

1. `IntersectionObserver` 统计可见比例 ≥ 50% 的累计 `visibleMs`。
2. 统计卡片级累计 `hoverMs` 与 `hoverCount`，不保存鼠标轨迹。
3. 卡片滚离后再次进入视口时增加 `returnCount`。
4. 捕获普通点击、中键、Ctrl/Cmd+点击等选择行为，设置 `clicked=true`。
5. 通过节流/批处理把聚合状态交给后台；禁止对 mousemove 高频写 storage。

验收：调试信息能显示每个 Candidate 的五项聚合字段；刷新或动态加载不产生重复监听；点击识别覆盖普通/中键/修饰键。

#### 当晚联调

给 A 线一份样例数据与字段解释。当天不要求算法完成，只要求“页面出现候选 → 产生聚合记录 → Side Panel 能看到样例”。录制 30～60 秒进度视频。

### 8/24：中期指导与风险冻结

你负责展示：

- 扩展如何加载；
- 候选如何从 DOM 转成统一 Candidate；
- 为什么只存聚合信号；
- 当前消息和存储数据流；
- MV3 Service Worker 休眠、点击识别、真实站点 DOM 变化等风险。

重点提问：

- MV3 会话恢复是否合理；
- 事件采集和权限是否最小；
- 行为信号是否足够可信；
- 隐私说明是否准确；
- Demo 路径是否稳定。

会后把建议分成必须改、可以改、暂不改。涉及新模型、新后端、第二站点的建议默认不进入比赛版。与 A 共同更新 MVP 清单。

### 8/25：完成 B4——Missed Path

实施顺序：

1. 冻结最小数据模型和 schemaVersion。
2. 实现纯函数 `normalizeSignals`；所有连续特征截断到 `[0,1]`。
3. 实现纯函数 `calculateConsideration`。
4. 实现 Session Manager 的一次性结算。
5. 实现 Repository 保存/查询 Missed Path。
6. 实现 `MISSED_PATHS_QUERY` 供 A 线读取。

文档冻结的初版公式：

```text
C = 0.30 × exposure
  + 0.30 × hover
  + 0.25 × return_view
  + 0.15 × repeated_hover

clicked = true → Chosen，不进入 Missed
clicked = false 且 C ≥ 0.55 → 会话结束时进入 Missed
```

注意：文档没有冻结曝光/hover 的具体归一化上限。把这些上限集中放入命名配置，并标注“待用户测试校准”；不要让 AI 把数值散落在代码中，也不要声称这些值已经验证。

Session Manager 必须保证：

- 同一 session 只结算一次；
- Chosen 永远不会随后成为 Missed；
- Service Worker 休眠/重启后可恢复未结算的聚合状态；
- 同一规范化 URL 去重，但保留最近或最高价值上下文；
- 每条 Missed 都有可解释 `reasons`。

验收：本地 Demo 稳定产生一条 Missed；点击项绝不进入 Missed；多次回看明显提高分数；刷新/重启后不会重复结算。

没完成时立即砍：个性化权重、动画、复杂会话图。

### 8/26：完成 B5——相关重逢与反馈

P0 使用关键词或 Jaccard 相似度，不引入 Embedding。

文档冻结的初版公式：

```text
R = 0.45 × context_similarity
  + 0.25 × prior_consideration
  + 0.15 × novelty_or_divergence
  + 0.15 × freshness
  - cooldown_penalty
  - repeated_dismissal_penalty
```

实施顺序：

1. 把当前上下文转为最小关键词集合。
2. 纯函数计算 `context_similarity`。
3. 纯函数计算 `R` 与可解释 reasons。
4. Repository 查询可重逢的 Missed，应用冷却与重复忽略惩罚。
5. 只返回得分最高的 1～3 条。
6. 实现 `RE_ENCOUNTER_QUERY`。
7. 分别实现打开、稍后/忽略、不相关、删除反馈。
8. 实现 `DEMO_SEED` 与 `DEMO_ADVANCE_CONTEXT`，显式标注 Demo。

如果 `novelty_or_divergence` 暂无可解释实现，P0 可以把它作为命名组件保留并设中性/零值，但必须在 README 写明；不要为了填公式而引入模型。

反馈语义：

- 打开：记录成功结果。
- 稍后：延长冷却，不作为负反馈。
- 不相关：记录 false positive，降低类似匹配。
- 删除：立即删除，不再生成同一记录。
- 暂停：停止新事件采集，不影响查看已有数据。

验收：相关上下文稳定触发；无关上下文不触发；同一候选不会频繁出现；反馈幂等；删除后无法再查到。

### 8/27：完成 B6——一个真实站点 Adapter

只选择一个稳定真实站点。选择标准：

- 搜索结果结构相对稳定；
- 比赛现场可访问；
- 所需权限最小且可说明；
- 不涉及密码、支付、医疗、金融或敏感账户页。

实施顺序：

1. 仅在新 Adapter 内加入选择器。
2. 实现 `canHandle`、`getContext`、`extractCandidates`、`observeChanges`。
3. 处理 SPA 导航/动态加载。
4. 处理 URL 规范化和重复结果。
5. 验证普通点击、中键、Ctrl/Cmd+点击。
6. 不把真实站点特例泄漏到评分、存储或 UI。

验收：真实页可识别候选和点击；动态加载不重复；站点变化导致失败时只降级该 Adapter，不破坏本地 Demo。

晚上执行 8/27 硬里程碑：本地 Demo 完整闭环连续成功 3 次。真实站点不稳定时，本地 Demo 仍为比赛主演示。

### 8/28：完成 B7——测试、误判与恢复

优先修复用户测试中影响闭环的问题。

必须覆盖：

- 长时间可见但无 hover：不应仅因页面停留就高分。
- 短暂 hover 后滚走：低分。
- 多次滚回未点击候选：分数明显提高。
- 普通/中键/Ctrl/Cmd+点击：归入 Chosen。
- 同一 URL 多次出现：规范化去重。
- Service Worker 休眠/重启：不重复结算、不丢聚合状态。
- 连续忽略同一候选：重逢频率降低并最终归档。
- 暂停或黑名单站点：不产生新记录。
- 删除和清空：数据不可再次查询。

共同观察至少 2 位用户。A 记录理解和价值问题，B 记录误判、重复、恢复和性能问题。

验收：无阻塞报错；核心测试真实运行并保留结果；不能自动验证的浏览器行为有明确手动检查表。

### 8/29：完成 B8——发布与技术 README

技术 README 必须包括：

- 支持的 Chrome 版本或环境假设；
- 安装 unpacked extension 的步骤；
- 构建、类型检查、测试命令；
- 目录结构与模块职责；
- 本地 Demo 完整操作路径；
- 一个真实站点 Adapter 的范围与限制；
- 使用的权限及逐项原因；
- local-first、保存内容、删除/暂停方式；
- 已知限制和 Demo 模式说明；
- 第三方库、AI 辅助和可选模型情况；
- 不含任何 API Key、Token 或个人路径。

验收：在一个干净目录/新环境按 README 完整安装一次；Demo 连续成功 3 次；构建产物不依赖开发机绝对路径。

### 8/30：完成 B9——功能冻结和稳定版本

中午建立功能冻结 tag 和可回退压缩包。此后：

- 不加功能、不换框架、不升级大依赖；
- 不临时调评分权重掩盖问题；
- 不接第二站点、不加入模型；
- 只修阻塞安装、主 Demo 或提交的问题。

录制时负责：准备稳定版本、清理控制台阻塞错误、确认数据种子可重置、确保备用视频展示的功能与代码一致。

至少完整彩排 3 次；现场不安装依赖、不修改阈值、不输入 API Key。

### 8/31：完成 B10——最终技术检查

18:00 前形成可提交版本。检查：

- 公开仓库包含完整源码和必要配置；
- README 命令在新环境可复现；
- 扩展包/构建产物可以加载；
- 无 `.env`、密钥、Token、个人数据、调试导出或绝对路径；
- Manifest 权限与 README 一致；
- Demo、仓库、安装说明链接在外部窗口可访问；
- 项目简介与视频中的技术表述真实；
- 第三方/AI 声明完整；
- 8/30 后没有混入新功能。

24:00 前正式提交；最后阶段不再修改功能。

## 5. 建议项目文件结构与所有权

先检查现有仓库。已有结构能工作时不要为匹配下面的建议而大规模移动文件。

```text
src/
├─ manifest.json
├─ content/                         # B 主责
│  ├─ adapters/
│  │  ├─ types.ts
│  │  ├─ registry.ts
│  │  ├─ demoAdapter.ts
│  │  └─ realSiteAdapter.ts        # 只保留一个真实站点
│  ├─ visibility.ts                # IntersectionObserver
│  ├─ eventCollector.ts            # hover/click/return 聚合
│  └─ contentScript.ts             # 组合，不放评分或存储实现
├─ background/                      # B 主责
│  ├─ serviceWorker.ts
│  ├─ messageRouter.ts
│  ├─ sessionManager.ts
│  ├─ consideration.ts             # 纯函数
│  ├─ reencounter.ts               # 纯函数与排序
│  └─ scoringConfig.ts             # 权重/阈值集中管理
├─ storage/                         # B 主责
│  ├─ repository.ts                # 统一接口
│  ├─ chromeStorageRepository.ts   # 或现有 IndexedDB 实现
│  └─ migrations.ts
├─ shared/                          # A+B 共同冻结
│  ├─ types.ts
│  ├─ messages.ts
│  ├─ constants.ts
│  ├─ url.ts
│  └─ result.ts
├─ sidepanel/                       # A 主责；B 提供 client 契约与联调
└─ demo/                            # 故事 A 主责；数据/Adapter B 主责
   ├─ index.html
   ├─ demo.ts
   ├─ fixtures.ts
   └─ scenarios.ts

tests/
├─ adapters/
├─ eventCollector/
├─ scoring/
├─ sessionManager/
├─ storage/
├─ messages/
└─ demo/

docs/
├─ architecture.md                 # B
├─ data-contract.md                # B 起草，A 复核
├─ permissions-and-privacy.md      # B 技术事实，A 用户表达
└─ manual-browser-checklist.md     # B 主责
```

## 6. 核心模块边界

| 模块 | 必须负责 | 严禁承担 |
|---|---|---|
| Site Adapter | 从 DOM 提取 Candidate；监听动态变化；解析最小上下文 | 评分、存储、UI、全局业务状态 |
| Event Collector | 采集并节流/聚合可见、hover、回看、点击 | 完整鼠标轨迹、页面全文、直接长期存储高频事件 |
| Session Manager | 会话建立、恢复、一次性结算、Chosen/Missed 状态转换 | 直接操作 DOM、渲染 UI |
| Consideration | 纯函数计算 C 和 reasons | 访问 DOM、storage、组件 |
| Re-encounter | 纯函数计算 R、冷却、排序与 reasons | 直接操作 Side Panel |
| Repository | 统一 CRUD、schemaVersion、迁移、删除 | 静默上传、评分、UI 文案 |
| Message Router | 校验消息、调用用例、返回统一结果 | 站点选择器、组件状态 |
| Side Panel | 展示、反馈、设置、Demo 控制 | 自行计算业务状态或直接依赖 Adapter |

正确的数据流：

```text
Demo/真实结果页
  → Site Adapter 输出 Candidate + SearchContext
  → Event Collector 输出 AggregatedSignals
  → Session Manager 持久化/恢复聚合状态
  → Consideration 结算 Chosen / Missed
  → Repository 保存 MissedPath
  → Re-encounter 查询与排序
  → Message Router 返回 DTO
  → A 线 Side Panel 展示与发送反馈
```

## 7. 最小数据模型

```ts
export const SCHEMA_VERSION = 1 as const;

export interface Candidate {
  id: string;
  url: string;
  title: string;
  source: string;
  rank: number;
  sessionId: string;
}

export interface AggregatedSignals {
  visibleMs: number;
  hoverMs: number;
  hoverCount: number;
  returnCount: number;
  clicked: boolean;
}

export interface SearchContext {
  query: string;
  source: string;
  timestamp: number;
  keywords?: string[];
}

export type ReasonCode =
  | "LONG_EXPOSURE"
  | "LONG_HOVER"
  | "REPEATED_HOVER"
  | "RETURN_VIEW"
  | "NOT_CLICKED"
  | "CONTEXT_MATCH";

export interface ExplanationReason {
  code: ReasonCode;
  label: string;
  contribution?: number;
}

export interface MissedPath {
  id: string;
  candidate: Candidate;
  context: SearchContext;
  score: number;
  reasons: ExplanationReason[];
  status: "MISSED" | "ELIGIBLE" | "REENCOUNTERED" | "ARCHIVED";
  createdAt: number;
}

export interface Reencounter {
  id: string;
  missedPathId: string;
  missedPath: MissedPath;
  triggerContext: SearchContext;
  score: number;
  reasons: ExplanationReason[];
  shownAt: number;
  outcome?: "OPENED" | "LATER" | "DISMISSED" | "NOT_RELEVANT" | "DELETED";
}

export interface Settings {
  enabled: boolean;
  allowlist: string[];
  blocklist: string[];
  thresholds: {
    consideration: number;
    reencounter: number;
  };
  demoMode: boolean;
}
```

存储建议：

- MVP 数据量较小时可使用 `chrome.storage.local`，但必须经过 Repository 抽象；已有 IndexedDB 时不要换实现。
- 保存聚合后的必要信号和业务实体，不保存高频原始事件。
- 每条记录带 schemaVersion；迁移保持向后兼容或显式失败。
- URL 保存前规范化并移除常见 tracking 参数。
- 支持单条删除、全部清空和本地数据查看/导出要求；导出若不影响主流程可后置。
- 暂停仅停止新采集，不影响查看已有数据。

## 8. A/B 消息契约

所有消息带 `schemaVersion`、`requestId`、判别类型和明确 payload：

```ts
type RequestMessage<TType extends string, TPayload> = {
  schemaVersion: typeof SCHEMA_VERSION;
  requestId: string;
  type: TType;
  payload: TPayload;
};

type ResponseMessage<T> =
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      requestId: string;
      ok: true;
      data: T;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      requestId: string;
      ok: false;
      error: { code: string; message: string; retryable: boolean };
    };
```

最小消息：

| 消息 | 发送方 → 接收方 | B 线行为 |
|---|---|---|
| `CANDIDATES_DISCOVERED` | Content → Background | 建立/更新会话候选，去重 |
| `SIGNALS_UPDATED` | Content → Background | 合并聚合信号，持久化可恢复状态 |
| `CANDIDATE_CHOSEN` | Content → Background | 原子地标记 Chosen，防止进入 Missed |
| `SESSION_FINALIZE` | Content/Demo → Background | 幂等结算一次会话 |
| `MISSED_PATHS_QUERY` | Side Panel → Background | 返回 Missed 列表和 reasons |
| `RE_ENCOUNTER_QUERY` | Side Panel/Demo → Background | 返回 0～3 条已排序结果 |
| `RE_ENCOUNTER_FEEDBACK` | Side Panel → Background | 幂等保存 outcome、冷却或删除 |
| `SETTINGS_UPDATE` | Side Panel → Background | 校验并保存设置，返回完整 Settings |
| `DATA_DELETE_ALL` | Side Panel → Background | 明确确认后清空相关本地数据 |
| `DEMO_SEED` | Demo/Side Panel → Background | 仅 Demo 模式载入固定种子 |
| `DEMO_ADVANCE_CONTEXT` | Demo/Side Panel → Background | 可控推进上下文和时间 |

每增加一个消息前，写清：发送方、接收方、触发时机、payload、状态变化、失败行为、是否可重试、是否幂等、测试方法。

错误处理：

- 未知 schemaVersion：结构化错误，不静默兼容。
- 未知消息：结构化 `UNSUPPORTED_MESSAGE`。
- 数据校验失败：不写 storage，返回不可重试错误。
- Service Worker 重启：从持久化状态恢复，不依赖长驻内存。
- Side Panel 关闭：后台操作仍保证一致性，返回结果可被下一次查询看到。

## 9. 关键工程实现说明

### 9.1 Candidate ID 与 URL 规范化

- Candidate ID 必须稳定，不能用每次扫描生成的随机值。
- URL 去除 fragment 和常见 tracking 参数；保留真正影响内容的查询参数。
- 同一规范化 URL 重复出现时去重，但不要把不同搜索会话粗暴合并成同一事件。
- URL 规范化应是共享纯函数，有测试；不要散落在 Adapter。

### 9.2 事件聚合

- `visibleMs` 只累计可见比例 ≥ 50% 的时间。
- 页面隐藏、候选离开视口或卸载监听时结算当前时间段。
- hover 使用 enter/leave 时间段累计，不记录路径。
- `returnCount` 只有“离开后再次进入”才增加，首次曝光不算返回。
- 点击事件必须覆盖普通点击、`auxclick` 中键以及 Ctrl/Cmd 等新标签行为。
- 使用委托监听、节流或批处理；不要给动态页面留下重复监听器。

### 9.3 会话与 MV3 恢复

- 关键会话状态不能只在 Service Worker 内存中。
- 会话结算必须幂等，可使用状态或 finalize token 防止重复。
- 对“何时结束一次会话”建立明确规则：Demo 显式 finalize；真实站点可结合查询变化、导航/页面离开等可靠事件。
- 不依赖长驻定时器；需要延迟工作时保存绝对时间并在唤醒后重新判断。

### 9.4 可解释评分

- `consideration.ts` 与 `reencounter.ts` 保持纯函数。
- 所有权重和阈值集中在 `scoringConfig.ts`。
- 返回 `{score, reasons}`，而不是只返回数字。
- UI 文案使用概率性表达，不由 B 线返回“系统知道用户想点”等确定性标签。
- 用户测试前的参数只是初始启发式，不宣称经过验证。

### 9.5 local-first 与权限

- 默认只在明确支持/允许的结果页运行，不使用 `<all_urls>`。
- 对每个 Manifest permission 和 host permission 写用途。
- 敏感站点和隐身模式默认禁用。
- 原始聚合信号应有保留期限；Missed Path 支持单条删除和全部清空。
- 若未来加入云端模型，必须是 P1，最小化发送文本、明确提示并保留完全本地模式；比赛 P0 不做。

## 10. 与 A 线的接口和交付

B 每天给 A：

1. 当天可运行版本或准确运行步骤。
2. Side Panel 可使用的数据样例及字段含义。
3. 当前最影响 Demo 的一个技术风险。
4. 次日希望 A 帮助验证的一个具体场景。

A 每天会给 B：

1. 最新界面截图或可运行页面。
2. 需要的数据字段与接口清单。
3. 用户/评委最可能误解的 1～3 点。
4. 次日唯一最高优先级。

接口冻结流程：

1. B 起草共享类型与示例 JSON。
2. A 使用示例渲染静态 UI。
3. A/B 逐字段确认名称、可空性、枚举和文案含义。
4. B 增加契约测试后冻结 schemaVersion 1。
5. 任何破坏性变更先更新契约和样例，再分别修改两线。

B 不要求 A：理解评分内部、访问 repository、处理 Adapter 特例。A 不要求 B：在后台生成最终中文 UI 文案或实现视觉布局。

## 11. 验收标准与测试

### 11.1 通用完成标准

- 任务开始前说明边界和拟修改文件。
- 只完成一个任务，不顺便重构。
- 运行仓库已有 typecheck、lint、unit test、build。
- 浏览器行为必须实际加载扩展并手动验证。
- 不能验证的内容明确写出，不声称通过。
- 新增权限/依赖前已获两人确认。
- 改动后向 A 线演示 3～5 分钟。
- 每晚保存可回退版本。

### 11.2 MVP 功能验收

- 加载 unpacked extension 无报错，Side Panel 可打开。
- Demo Adapter 能稳定提取 Candidate，动态新增不重复。
- 曝光、hover、回看、点击被聚合且可调试验证。
- 已点击候选绝不进入 Missed。
- 高分未点击候选在会话结束时生成 Missed。
- 每条 Missed 至少一个可解释 reason。
- 相关上下文返回 1～3 条重逢；无关上下文不触发。
- 打开、稍后/忽略、不相关、删除正确更新状态。
- 暂停后无新记录；删除后不可查询；清空生效。
- 浏览器/Service Worker 重启后关键状态恢复。
- 弱网或离线环境下，5 分钟内可稳定复现完整 Demo。

### 11.3 核心自动化/手动测试矩阵

| 用例 | 优先测试层 | 通过条件 |
|---|---|---|
| URL 规范化 | 单元测试 | tracking 参数移除；内容参数保留；结果稳定 |
| Candidate 去重 | Adapter 测试 | 初始/动态扫描不重复 |
| visibleMs | 单元 + 浏览器手动 | 仅可见 ≥50% 时间累计 |
| hover 聚合 | 单元 + 浏览器手动 | 只保存累计时间/次数，无轨迹 |
| returnCount | 单元测试 | 首次进入不计；离开后再进入计数 |
| 点击识别 | 浏览器手动/集成 | 普通、中键、Ctrl/Cmd 都是 Chosen |
| Consideration | 纯函数单元测试 | 权重、截断、阈值、reasons 正确 |
| Session finalize | 单元/集成 | 重复 finalize 只产生一次结果 |
| Repository | 单元/集成 | CRUD、删除、清空、迁移正确 |
| Re-encounter | 纯函数单元测试 | 相关排序、冷却、忽略惩罚正确 |
| Message Router | 契约测试 | 版本、payload、错误、requestId 对齐 |
| SW 恢复 | 浏览器手动/集成 | 休眠/重启不丢失、不重复结算 |
| Demo 闭环 | 手动验收 | 连续 3 次完整成功 |

## 12. 比赛材料中 B 线负责的内容

### 8/24 中期指导

- 开发起点证明：仓库创建时间、第一条 commit、初始结构和首次运行截图。
- 工程现状：扩展骨架、候选识别、聚合事件、存储样例。
- 技术风险：MV3 休眠、点击漏判、动态 DOM、权限和隐私。
- 技术问题清单：行为信号合理性、恢复策略、真实站点风险。

### 最终 README 和提交

- 安装、构建、运行、测试命令。
- 技术架构、数据流、目录结构。
- 权限、local-first、保存内容与删除方式。
- 本地 Demo 与真实站点适配范围。
- 已知限制、冻结功能和失败回退。
- 可安装包或明确构建产物。
- 公开仓库无密钥、个人数据和绝对路径。
- 视频中的技术功能真实存在。

## 13. 给 Codex / Cursor / Claude Code 的分阶段提示词

新对话先发“提示词 0”。AI 复述并停止后，一次只发后续一个任务。前一个任务未验收，不发送下一个。

### 提示词 0：建立项目上下文，不写代码

```text
你是 The Unclicked（余路）项目的开发协作者。我负责 B 线：浏览器扩展核心、数据与集成。先理解项目，不要写代码。

产品是 Chrome Manifest V3 浏览器扩展，主要 UI 为 Side Panel。它从搜索结果卡片的曝光、hover、回看、滚动返回和点击中保存最小聚合信号，推测“认真考虑但最终没有选择”的候选，形成 Missed Path；未来相关上下文中，以少量、克制、可解释的方式让候选 Re-encounter。

冻结边界：
1. 不是收藏夹、Tab 管理器、AI 搜索、论文总结或普通推荐系统。
2. local-first；不采集键盘、表单、密码、Cookie、Token、完整正文或完整鼠标轨迹。
3. P0 不依赖大模型；使用可解释启发式和关键词/Jaccard。
4. DOM 选择器只在 Adapter；评分、存储、UI 不耦合站点。
5. Side Panel 不计算业务状态；B 通过消息和共享 DTO 提供数据。
6. MV3 Service Worker 会休眠；关键状态必须持久化、可恢复、幂等。
7. 权限最小化；新增依赖、权限、服务、上传、后端或模型前必须等待确认。
8. 本地 Demo 优先；只接一个真实站点；不能依赖网络/API Key/真实等待。
9. 一次只做一个边界明确的任务，不顺手重构。

收到任务后：先检查仓库，复述任务边界，列拟修改文件与验证方法；实施最小改动；运行真实测试；报告改动、文件、命令、结果和限制。不能验证时明确说明。

请用不超过 10 条复述项目、B 线职责、冻结边界和优先顺序，然后停止等待任务。
```

### 提示词 1：只审计仓库

```text
任务名称：只读审计 The Unclicked 当前仓库。

不要修改文件。找出 Manifest、Service Worker、Content Script、Side Panel、Demo、Adapter、消息、共享类型、存储、测试与构建入口。画出当前数据流，并列出：
1. B1/B2/B3 已完成和缺失项；
2. 当前可运行命令；
3. 已申请权限及用途；
4. 与冻结边界冲突的内容；
5. 下一项最小任务及允许修改的文件。

不要安装依赖、不要生成代码、不要重构。
```

### 提示词 2：只修到可安装骨架

```text
任务名称：完成最小 Manifest V3 可安装骨架。

目标：加载 unpacked extension 无报错，Side Panel 可打开，Service Worker、Content Script/本地 Demo 和 Side Panel 能完成最小 ping/pong。

先复用仓库现有技术栈。允许修改 Manifest 与必要入口/最小消息文件。明确不做：事件采集、评分、存储业务、真实站点、复杂 UI、依赖升级、新权限。

若需新增 permission 或 host_permission，先停止并解释用途，等待确认。

验收：给出加载步骤、控制台检查位置、ping/pong 手动路径，并运行 typecheck/test/build。
```

### 提示词 3：只定义 Site Adapter 接口

```text
任务名称：定义 Site Adapter 接口和 registry，不实现具体站点。

接口只负责 canHandle、getContext、extractCandidates、observeChanges；输出统一 Candidate/SearchContext。DOM 选择器不得出现在接口/registry 外的业务模块。

允许修改：content/adapters 的类型、registry 与单元测试。明确不做：Demo Adapter、真实站点、事件采集、评分、存储、UI、依赖。

验收：无可处理站点、有一个匹配、多个匹配冲突、卸载观察器都有测试；运行 typecheck/test/build。
```

### 提示词 4：只实现本地 Demo Adapter

```text
任务名称：实现本地 Demo Adapter。

目标：从仓库已有本地 Demo 搜索页提取稳定 Candidate：id、规范化 URL、title、source、rank、sessionId，并解析最小 SearchContext；动态新增结果不重复。

只修改 Demo Adapter、必要 fixture 和 Adapter 测试。不要实现事件、评分、存储、Side Panel、真实站点，不加依赖。

URL 规范化若尚不存在，先提出一个独立后续任务，不要在本任务顺便搭完整工具层。

验收：初始提取、动态新增、空标题/坏链接安全跳过、去重、观察器清理均有测试；运行 typecheck/test/build。
```

### 提示词 5：只实现 visibleMs

```text
任务名称：只实现候选曝光累计 visibleMs。

使用 IntersectionObserver；只有可见比例 ≥50% 才累计。候选离开视口、页面隐藏、会话结束或清理监听时结算当前区间。

允许修改：visibility 模块及测试、eventCollector 中最小接线。明确不做：hover、return、click、storage、评分、UI。

验收：首次进入、低于阈值、跨多段可见、页面隐藏、候选删除、重复注册和 cleanup 都有测试；不得直接写 storage；运行 typecheck/test/build。
```

### 提示词 6：只实现 hover 聚合

```text
任务名称：只实现卡片级 hoverMs 和 hoverCount 聚合。

使用进入/离开时间段累计，不保存 mousemove 或坐标，不高频写 storage。支持动态候选并避免重复监听。

允许修改：eventCollector 的 hover 子模块和测试。明确不做：visible、return、click、评分、存储、UI。

验收：单次、多次、未离开时 cleanup、候选移除、重复监听都有测试；输出只有累计值；运行 typecheck/test/build。
```

### 提示词 7：只实现 returnCount

```text
任务名称：只实现候选回看计数 returnCount。

定义：候选首次进入视口不计；离开后再次进入才加 1。与已有 visibility 状态复用，但不要改评分。

允许修改：visibility/eventCollector 的最小状态机及测试。明确不做：点击、存储、评分、UI、重构。

验收：首次进入、重复 observer 回调但未真正离开、离开再进入、多次返回、候选卸载均有测试；运行 typecheck/test/build。
```

### 提示词 8：只实现 Chosen 点击识别

```text
任务名称：只实现 CANDIDATE_CHOSEN 采集。

捕获普通点击、中键 auxclick、Ctrl/Cmd+点击等新标签行为，把 Candidate 标为 clicked=true，并发送一次类型安全消息。不得阻止浏览器默认导航。

允许修改：content click collector、共享消息的最小必要部分和测试。明确不做：Session finalize、Missed 评分、storage、Side Panel。

要求：重复事件幂等；动态卡片使用安全委托；不采集键盘输入或页面正文。

验收：所有点击方式、嵌套元素点击、重复事件、非 Candidate 点击都有测试/手动检查；运行 typecheck/test/build。
```

### 提示词 9：只定义共享业务类型与消息协议

```text
任务名称：冻结 schemaVersion 1 的共享类型和消息协议。

定义 Candidate、AggregatedSignals、SearchContext、MissedPath、Reencounter、Settings，以及 CANDIDATES_DISCOVERED、SIGNALS_UPDATED、CANDIDATE_CHOSEN、SESSION_FINALIZE、MISSED_PATHS_QUERY、RE_ENCOUNTER_QUERY、RE_ENCOUNTER_FEEDBACK、SETTINGS_UPDATE、DATA_DELETE_ALL、DEMO_SEED、DEMO_ADVANCE_CONTEXT。

消息必须有 schemaVersion、requestId、判别 payload 和统一 success/error response。优先扩展现有类型，禁止创建第二套。

只修改 shared 类型/消息和契约测试；不实现 Router、storage、评分或 UI。若现有字段冲突，先停下列差异。

验收：严格 TypeScript 通过；合法/非法版本和 payload 有测试；运行 typecheck/test/build。
```

### 提示词 10：只实现 Consideration 纯函数

```text
任务名称：实现可解释的 Consideration Score 纯函数。

使用冻结公式：0.30*exposure + 0.30*hover + 0.25*return_view + 0.15*repeated_hover；连续特征先归一化并截断 [0,1]；初始阈值 0.55；clicked=true 必须排除。

返回 score、classification 和 reasons。归一化上限集中在 scoringConfig，并明确标注待 5～10 人测试校准；不要声称已验证。

只修改 consideration、scoringConfig 和纯函数测试。明确不做：Session Manager、storage、消息、UI、模型。

验收：边界值、截断、点击排除、阈值上下、强回看、仅长曝光、reasons 均有测试；运行 typecheck/test/build。
```

### 提示词 11：只实现 Repository 最小接口

```text
任务名称：实现 local-first Repository 最小接口。

目标：在仓库现有存储技术上提供会话聚合状态、Chosen、MissedPath、Reencounter、Settings 的必要读写，以及单条删除、全部清空、schemaVersion。已有实现能用时不更换。

只修改 storage/repository、具体存储适配和测试。明确不做：评分、Session Manager、消息 Router、UI、云端同步。

要求：所有写入最小化；不保存完整页面、鼠标轨迹、Cookie/Token；删除后查询不到；错误不静默吞掉。

验收：CRUD、重复写、删除、清空、版本不兼容和失败回滚有测试；运行 typecheck/test/build。
```

### 提示词 12：只实现 Session finalize

```text
任务名称：实现一次性会话结算。

输入为会话 Candidate + AggregatedSignals；调用已有 Consideration 纯函数；clicked 候选归入 Chosen；未点击且达到阈值的候选生成带 reasons 的 MissedPath；通过 Repository 原子/幂等保存。

只修改 sessionManager 及测试，必要时对 Router 做最小接线。明确不做：Re-encounter、真实站点、UI、模型、大重构。

要求：重复 SESSION_FINALIZE 不重复生成；Service Worker 重启后从持久化状态判断；部分失败不得留下矛盾状态。

验收：Chosen 排除、阈值上下、重复 finalize、空会话、恢复后 finalize、存储失败均有测试；运行 typecheck/test/build。
```

### 提示词 13：只实现 MISSED_PATHS_QUERY

```text
任务名称：实现 Side Panel 查询 Missed Path 的消息处理。

通过现有 messageRouter 校验 schemaVersion/requestId/payload，调用 Repository，返回共享 ResponseMessage。不要让 Side Panel 直接访问 storage。

只修改 MISSED_PATHS_QUERY 路由、用例和契约/集成测试。明确不做：其他消息、UI、评分、重构 Router。

验收：成功、空列表、未知版本、非法 payload、storage 失败和 requestId 回传都有测试；运行 typecheck/test/build，并给 A 一份示例响应 JSON。
```

### 提示词 14：只实现 Re-encounter 纯函数

```text
任务名称：实现 P0 Re-encounter 评分与排序纯函数。

使用关键词/Jaccard 计算 context_similarity，并按冻结公式组合 prior_consideration、novelty_or_divergence、freshness、cooldown 和 repeated dismissal penalty。只返回最高 1～3 条和可解释 reasons。

如果 novelty_or_divergence 暂无可靠 P0 实现，使用命名的中性/零值并记录限制，不引入 Embedding/模型。

只修改 reencounter、scoringConfig 和纯函数测试。明确不做：Router、Repository、反馈、UI、真实站点。

验收：相关/无关、排序、上限 3、冷却、重复忽略、稳定 tie-break、reasons 均有测试；运行 typecheck/test/build。
```

### 提示词 15：一次只实现一个重逢消息

依次把 `{MESSAGE}` 替换为 `RE_ENCOUNTER_QUERY`、`RE_ENCOUNTER_FEEDBACK`、`DEMO_SEED`、`DEMO_ADVANCE_CONTEXT`，每次新开一个任务。

```text
任务名称：只实现 {MESSAGE}。

先检查共享契约，列出发送方、接收方、触发时机、状态变化、失败行为、幂等要求和测试。只修改该消息的 Router/use case/测试；必要时调用已有 Repository 或纯函数。

明确不做：其他消息、UI、评分算法重构、新依赖、模型、真实站点。

验收：成功、非法 payload、未知版本、业务失败、重复请求和 requestId 回传有测试；运行 typecheck/test/build；给 A 一份示例请求/响应 JSON。
```

### 提示词 16：只实现一个真实站点 Adapter

```text
任务名称：实现团队已经确认的唯一真实站点 Adapter。

开始前确认目标域名与获批 host permission；如果尚未确认，停止并提问。选择器只能在该 Adapter。复用统一 Candidate/SearchContext、URL 规范化和事件采集，不修改评分、存储或 UI。

只修改真实站点 Adapter、registry 最小注册、fixture/测试和经确认的 Manifest host permission。不要支持第二站点、不要使用 <all_urls>、不要抓全文。

验收：初始结果、动态加载、SPA 导航、去重、普通/中键/Ctrl/Cmd 点击、选择器失败降级、cleanup 均通过；本地 Demo 不受影响；运行 typecheck/test/build并给出手动验证步骤。
```

### 提示词 17：只做 MV3 恢复审计与修复

```text
任务名称：审计并修复 Service Worker 休眠/重启后的核心状态恢复。

先只读画出哪些状态目前只存在内存、哪些已持久化、哪些定时器依赖长驻 Worker。按优先级只修影响会话结算、Chosen 排除、Missed 保存或重逢冷却的问题。

允许修改：sessionManager、repository、serviceWorker 恢复接线和针对性测试。明确不做：UI、Adapter、算法权重、功能新增、大重构。

验收：休眠/重启后不丢信号、不重复 finalize、Chosen 不变 Missed、冷却不失效；运行自动测试并给出 Chrome 手动休眠验证步骤。
```

### 提示词 18：只审计发布与隐私

```text
任务名称：对功能冻结版本做发布、权限、隐私和密钥审计。

只读检查：Manifest 权限、host 权限、构建产物、README 命令、绝对路径、密钥/Token/.env、调试数据、依赖声明、local-first、暂停/删除/清空、敏感站点、Demo 标记、公开仓库完整性。

输出按“阻塞提交 / 应修 / 可忽略”排序的清单，标明证据文件和最小修复建议。不要直接修改，等待我逐项发送单项修复任务。
```

## 14. 落后时怎么砍功能

按顺序砍掉：

1. 大模型、Embedding、复杂学习算法 → 保留启发式分数和关键词匹配。
2. 第二个及更多真实站点 → 保留一个真实站点和本地 Demo。
3. 复杂路径地图、动画、大屏 → 保留 Side Panel 卡片。
4. 账号、云同步、后端数据库 → 保留本地存储。
5. 自动个性化权重 → 保留固定权重和反馈记录。

绝对不能砍：

- 可安装、可运行扩展或明确 Demo；
- 一条 Missed Path 的形成过程；
- 一次相关情境中的重逢；
- “为什么记录、为什么重现”的 reasons；
- local-first、暂停、删除/清空；
- 公开代码仓库、README、Demo 视频、项目简介。

## 15. 你现在最先做什么

如果现在是 8/23：

1. 把“提示词 0”发给 AI，让它只复述上下文。
2. 发“提示词 1”做仓库只读审计。
3. 如果扩展还不能安装，执行“提示词 2”。
4. 骨架可安装后，依次执行“提示词 3”和“提示词 4”，先完成 Adapter 接口与本地 Demo Adapter。
5. 再分别执行“提示词 5～8”，逐项完成 visible、hover、return、click；不要一次生成整个采集系统。
6. 傍晚给 A 一份 Candidate/AggregatedSignals 示例 JSON 和字段说明。
7. 晚上合并后完整跑一遍“页面候选 → 聚合记录 → Side Panel 样例展示”，保存稳定 commit 并录制进度视频。

今天的唯一最高优先级应是：**让本地 Demo 页中的候选稳定变成聚合数据，并能交给 Side Panel 使用。**不要提前做真实站点、模型或完整重逢。
