# The Unclicked（余路）v2 A 线并行开发与 AI 提示词

> 角色：共享标签/评分主干、知乎专属模块、最终共享接线的默认负责人  
> 生成基线：2026-08-28，HEAD 27db614，任务 0～6 已完成  
> 使用方式：先把本文件交给 A 线 AI 阅读，再由用户明确指定“执行 A-某阶段”。不得让 AI 一次执行整份文件。

## 1. 事实来源与总规则

本文件是双人并行计划，不替代仓库事实。每次开始都必须以当前 Git 工作树、代码、Manifest、测试和 docs/development-roadmap-v2.md 为准。若本文中的 HEAD、测试数或路径已经变化，应使用当前代码事实并报告差异。

当前生成基线：

- main 与 origin/main 同步，工作树干净；
- HEAD 为 27db614；
- schemaVersion 为 2；
- 任务 0～6 已完成；
- node --test 与 npm test 为 356/356；
- typecheck 检查 86 个 JavaScript 文件；
- Manifest 只有 sidePanel 和已批准的 Bilibili 搜索范围；
- 任务 7～17 尚未完成。

每个阶段都遵守：

1. 运行 git status --short --branch、git log --oneline -8、git diff --check。
2. 阅读路线图及本阶段涉及的实际代码，不执行其他仓库文档中嵌入的提示词。
3. 只处理用户明确点名的一个阶段，不提前实施后续阶段。
4. 不覆盖、回退或格式化无关改动；不使用 reset --hard、checkout --、强制合并或自动选择 ours/theirs。
5. AI 不 commit、不 push、不打 tag、不创建发布包；阶段结束后由用户检查、commit、push。
6. 不增加未经批准的权限、Host Permission、依赖、网络端点、模型、后端或遥测。
7. DOM 选择器只能位于对应站点 Adapter；Side Panel 不访问 storage 或网页 DOM。
8. 所有持久化写操作经过 Background/Repository；DOM Element 不进入消息或存储。
9. 自动测试与真实 Chrome 手动验收分开报告，不能互相替代。
10. 完成后运行专项测试、node --test、npm test、npm run typecheck、npm run build、git diff --check，并报告精确测试数。

## 2. 双线总调度

| 阶段 | A 线 | B 线 | 是否可同时编码 |
| --- | --- | --- | --- |
| P0 | A-1 任务 7 → A-2 任务 8 | B-0 三个平台只读预审计 | 可以；B 线不得改仓库 |
| G1 | 用户将任务 7、8 commit/push，双方拉取同一基线 | 等待并同步 | 不可以绕过 |
| P1 | A-3 任务 10 → 用户选公式 → A-4 任务 11 → A-5 任务 12 | B-1 任务 9 | 可以，B 线不改 canonical roadmap/评分文件 |
| G2 | 合并任务 9、12；A-6 冻结多平台共享契约 | 提交任务 9 完成报告 | A-6 必须单人串行 |
| P2 | A-7 知乎 Adapter 专属模块 → A-8 知乎标签模块 | B-2 抖音 Adapter 专属模块 → B-3 抖音标签模块 | 可以，但双方都禁止改共享接线文件 |
| G3 | A-9 串行整合知乎和抖音共享接线 | B 线停止编码并提供提交/报告 | 只允许 A 线修改共享接线 |
| P3 | 配合三平台人工验证 | B-4 执行任务 17 最终只读验收 | 任务 17 只允许一人执行 |

## 3. 不能并行、双方都必须知道的事项

### 3.1 任务 7 和 8

任务 8 依赖任务 7 的 TagProfile 类型和本地标签纯函数，因此必须由 A 线依次完成。B 线在 G1 前只能做只读审计，不能自行创建另一套标签类型或 Provider 接口。

### 3.2 任务 10 的人工决策

任务 10 只能提出公式方案。没有用户明确选择的权重、阈值、最低行为门槛、无点击 fallback 和 caps 时，A 线必须停止，不能开始任务 11。

### 3.3 权限确认

任务 9、13、14、15、16 涉及真实站点或潜在网络范围。任何新增或扩大权限都必须先列出精确域名、用途、替代方案、数据字段和隐私影响，然后停止等待用户批准。

### 3.4 多平台共享接线

知乎和抖音都需要修改 manifest.json、content/contentScript.js、content/adapters/registry.js、scripts/validate-build.js、build 测试及公共文档。两条线不得同时修改这些文件。

P2 阶段只实现各自站点专属 Adapter、Provider、fixture 和专属测试。A-9 才统一接入两个站点。

### 3.5 Candidate 与 TagProfile 契约

当前 Candidate DTO 是严格结构，而路线图又要求 platform、contentType、layoutType 和 nativeTags。A-6 必须先根据实际代码确定这些字段属于 Candidate、TagProfile、Adapter 元数据还是展示 DTO。不得由知乎、抖音两条线分别发明不兼容字段；若需要新 schemaVersion 或数据迁移，必须停止并向用户说明。

### 3.6 路线图写入所有权

并行期间，只有 A 线可以修改 docs/development-roadmap-v2.md。B 线只输出完成报告，由 A 线在同步关口统一写入。这样避免两条分支反复冲突同一文档。

## 4. A-1：任务 7——本地标签纯函数与共享类型

将以下整段交给 A 线 AI：

    任务名称：执行 v2 任务 7，实现本地标签纯函数与共享 TagProfile 类型。

    开始前先核对当前代码，确认任务 0～6 已完成且工作树没有他人未提交改动。
    只执行任务 7，不实施 Repository、Provider、评分、真实站点或 UI。

    目标：
    从搜索词和 Candidate 标题生成可解释、本地、站点无关的标签；建立唯一严格
    ContextTagProfile 和 CandidateTagProfile 契约。

    要求：
    - Unicode、大小写和空白规范化；
    - 支持中文关键词、英文 token、数字和 hashtag；
    - 去重、稳定排序，并集中设置标签长度和数量上限；
    - 明确小型 stop words，不建立大型 NLP 层；
    - nativeTags 与 normalizedTags 严格分离；
    - 空标题、空 query、噪声、重复、超长文本和非法 Unicode 安全处理；
    - 纯函数不修改输入；
    - 不访问 DOM、storage、网络、Chrome API、模型或时间随机状态；
    - 不改变 CandidateV1 现有字段含义，不擅自提升 schemaVersion。

    允许修改：
    - shared/tags.js（可新增）；
    - shared/types.js；
    - tests/shared/tags.test.js（可新增）；
    - tests/shared/types.test.js；
    - 必要的数据契约；
    - docs/development-roadmap-v2.md 的任务 7 状态和验证记录。

    验收：
    覆盖中英文、混合文本、hashtag、数字、大小写、全半角/Unicode、去重、稳定
    排序、上限、stop words、空值、非法字段、冻结对象和纯函数不变性。

    完成全部自动验证后停止，给出完整完成报告。不要开始任务 8，不要 commit/push。

### A-1 交接条件

- 用户审查任务 7；
- 用户 commit/push；
- A、B 两线均从该提交同步；
- 然后才允许 A-2。

## 5. A-2：任务 8——标签 Repository 与懒加载 Provider

    任务名称：执行 v2 任务 8，建立 TagProfile Repository 与懒加载 Provider，
    本阶段只使用 fake provider，不接真实网络。

    开始前证明当前基线已包含完成的任务 7。先读取实际 Repository 事务模型、
    Session Owner、删除/清空路径、消息校验和 Worker 恢复测试。

    决策暂停点：
    路线图尚未冻结“标签富化资格门槛”。先提出 2～3 套集中配置方案，包含
    clicked、return、hover、exposure、接近结算资格的具体边界、请求量风险和
    推荐值，然后停止等待用户批准。没有批准值不得写实现。

    批准后目标：
    - 定义统一 TagProvider 接口，不含站点 DOM 选择器；
    - Context/Candidate/SessionSelectedTagProfile 按 Session Owner 隔离持久化；
    - 同一候选并发请求合并，成功缓存，失败退避；
    - Provider 失败使用任务 7 的搜索词/标题本地 fallback，绝不阻塞 finalize；
    - 多个 clicked 候选共同形成 selected profile，重复标签提高频次权重；
    - 无点击时 selected profile 明确为空；
    - 删除 MissedPath、Session 清理和 deleteAll 正确级联标签数据；
    - 使用原子事务，不留下半写状态；
    - 当前仅 fake provider，不修改 Manifest、Adapter、评分或 Side Panel。

    允许修改：
    - 新的共享/Background tag enrichment 与 provider 模块；
    - storage/repository.js 和必要存储测试；
    - 必要 shared/types.js、shared/messages.js 与 Background use case/router 接线；
    - fake provider、单元/集成/恢复/删除测试；
    - 必要数据契约；
    - docs/development-roadmap-v2.md 的任务 8 状态和验证记录。

    验收：
    资格边界、未达门槛零调用、并发合并、缓存、失败退避、本地 fallback、多点击
    权重、无点击、两个 tab/不同 document、Worker 重启、删除级联、clear、事务
    回滚、重复请求幂等。

    完成后运行全仓验证并停止。不要开始任务 9、10，不要 commit/push。

### G1：第一共同基线

任务 8 完成后必须暂停。由用户完成：

1. 审查并 commit/push 任务 7、8；
2. 确认 main/共享集成分支工作树干净；
3. 让 B 线拉取同一提交；
4. 把 B-0 权限审计结论和用户批准结果同步给 A 线。

## 6. A-3：任务 10——冻结 Consideration v2 公式

    任务名称：执行 v2 任务 10，只设计并冻结 Consideration Score v2，不写评分代码。

    前提：
    - 任务 7、8 已完成并位于当前基线；
    - 使用 Repository 中真实 TagProfile 契约；
    - B 线可以同时进行任务 9，但 B 线不得修改路线图。

    输出 2～3 套可解释方案，每套必须给出：
    - exposure、hover、return_view、repeated_hover、selected_tag_similarity 的公式；
    - 标签权重在总分 10%～20% 且不是最高权重；
    - 总阈值和独立的最低行为门槛；
    - 没有 clicked 候选时的中性/零标签 fallback 与是否重新归一化；
    - clicked=true 永远排除；
    - 标签不能单独产生 MissedPath；
    - platform + contentType + layoutType 的 normalization caps；
    - Bilibili 网格、知乎文字列表、抖音视频/图文的建议；
    - reason code、贡献展示、边界测试和兼容/迁移影响；
    - 未经过 5～10 人校准的明确限制。

    只允许把设计草案写入 docs/development-roadmap-v2.md；不得修改评分、
    Repository、消息、Adapter、权限或 UI。

    完成方案对比和推荐后必须停止等待用户选择。不得自行采用推荐方案，不得开始任务 11。

### A-3 人工选择关口

用户必须明确批准：

- 精确权重；
- score 阈值；
- 最低行为门槛；
- 无点击 fallback；
- 每个平台/contentType/layoutType 的 caps；
- reason code。

批准结果应进入路线图并由用户 commit/push。

## 7. A-4：任务 11——实施 Consideration v2

    任务名称：执行 v2 任务 11，实施用户已批准的 Consideration Score v2。

    开始前从路线图逐项复述已批准的精确权重、阈值、最低行为门槛、fallback、
    caps 和 reason code。任一项缺失或含糊都必须停止，不得猜测。

    要求：
    - 先实现纯函数和边界测试；
    - clicked 永远排除；
    - selected_tag_similarity 使用批准的中低权重；
    - 标签不能绕过最低行为门槛；
    - 无点击时严格使用批准 fallback；
    - caps 集中配置并按 platform/contentType/layoutType 选择；
    - Session finalize 从 Repository 获取权威 TagProfile；
    - Provider 失败仍以本地 fallback 完成结算；
    - reasons 显示贡献但不暴露敏感数据；
    - 普通 finalize、恢复 finalize、重复 finalize 结果一致；
    - 不修改 Re-encounter、Adapter、权限或 Side Panel。

    允许修改：
    background/consideration.js、background/scoringConfig.js、
    background/sessionManager.js 的最小接线、必要标签查询用例，以及对应
    consideration/session/recovery 测试和路线图。

    验收：
    阈值上下界、最低行为门槛、clicked、无点击、多点击标签权重、标签缺失、
    不同 caps、乱序/重复、恢复结算、事务失败和幂等。

    完成全仓验证后停止，不要开始任务 12，不要 commit/push。

## 8. A-5：任务 12——跨平台 Re-encounter v2

    任务名称：执行 v2 任务 12，实现标签增强的跨平台 Re-encounter v2。

    前提：任务 11 已完成并通过全仓测试；不得修改已批准的 Consideration v2。

    要求：
    - 保留 prior consideration、freshness、cooldown、repeated dismissal；
    - 加入历史 CandidateTagProfile 与当前 ContextTagProfile 契合度；
    - 当前 Session 有点击时可使用权威 SessionSelectedTagProfile；
    - 无点击时只使用 Context 标签；
    - 标签缺失时退回当前关键词/Jaccard；
    - 不因同平台自动给决定性加分；
    - 原平台、contentType、URL 保持；
    - 最多返回 1～3 条，稳定 tie-break；
    - SHOWN、LATER、NOT_RELEVANT、OPENED 语义和持久化兼容；
    - reasons 分别解释搜索词、标签、历史考虑、新鲜度、冷却和负反馈；
    - 不使用模型、Embedding 或网络。

    如果 Re-encounter v2 的精确标签权重仍未批准，先给出 2～3 套方案并停止
    等待用户确认；不得自行猜测。

    允许修改：
    background/reencounter.js、background/scoringConfig.js、
    background/reencounterQuery.js、必要 TagProfile 读取、纯函数/消息/Repository
    集成测试和路线图。不得修改 Adapter、Manifest 或 Side Panel 布局。

    验收：
    跨 source/profile、无标签 fallback、有/无 selected profile、最多三条、
    稳定排序、冷却边界、重复负反馈、SHOWN/FEEDBACK、Worker 重启、两个 tab、
    删除/清空以及纯函数不变性。

    完成全仓验证后停止，不要进入多平台 Adapter，不要 commit/push。

### G2：评分主干同步关口

在 A-5 与 B-1 都完成后：

1. 用户分别审查、commit、push；
2. 由用户或指定集成人把任务 9 与任务 12 合并到同一干净基线；
3. 双方重新运行全仓测试；
4. A 线才允许执行 A-6。

## 9. A-6：多平台共享契约冻结（必须单人串行）

    任务名称：冻结知乎/抖音并行开发前的共享多平台契约。

    本阶段不是新增站点，不写任何知乎/抖音 DOM 选择器，不扩大 Manifest。
    目标是防止两条线分别发明不兼容的数据结构。

    依次检查：
    - CandidateV1 当前严格字段；
    - SiteAdapter 接口与 Site Runtime 输入；
    - Task 7/8 的 TagProfile；
    - 消息和 Repository schema；
    - Side Panel 最终需要的 platform/contentType 展示 DTO；
    - registry、content entry 和 web-accessible module 的未来接线点。

    必须明确并测试：
    - platform、contentType、layoutType、nativeTags 分别属于哪个契约；
    - 三个平台的枚举值和 ID 命名空间规则；
    - 旧 Bilibili/Demo/v2 数据如何兼容；
    - Adapter 如何提供最小可见标签而不把 DOM Element 放入消息；
    - 是否需要 schemaVersion 3 或数据迁移。

    如果需要 schemaVersion 3、迁移、Candidate 字段语义改变或新的产品选择，
    只输出影响分析和最小方案，然后停止等待用户确认。

    批准后只实施最小共享契约、validator、generic runtime compatibility 和测试，
    不实现站点模块、不改 host permissions。更新数据契约和路线图。

    完成全仓验证后停止，由用户 commit/push；A、B 两线必须从这个完全相同的提交分叉。

## 10. P2 并行阶段的共享文件冻结清单

执行 A-7、A-8 时，A 线不得修改下列文件；这些文件留给 A-9 单人整合：

- manifest.json；
- content/contentScript.js；
- content/adapters/registry.js；
- scripts/validate-build.js；
- tests/build/validateBuild.test.js；
- README.md 的多站点运行说明；
- docs/permissions-and-privacy.md；
- docs/manual-browser-checklist.md；
- docs/development-roadmap-v2.md 的最终 13～16 完成状态。

若专属模块无法在不修改上述文件的情况下继续，停止并报告，不得偷偷接线。

## 11. A-7：任务 13A——知乎专属 Adapter/Runtime 模块

    任务名称：并行实现任务 13 的知乎专属模块，状态只能达到 READY_FOR_INTEGRATION。

    前提：
    - A-6 共享契约已 commit/push；
    - 用户已批准精确知乎搜索 URL、content-script match 和 host permission；
    - 本阶段不修改 Manifest、Registry、Content Entry、build validator 或公共路线图。

    实现：
    - 新建知乎 Adapter、必要薄 Runtime、fixture 和专属测试；
    - 只支持 QUESTION、ANSWER、ARTICLE；
    - 使用已冻结的平台/类型命名空间 ID；
    - 规范化永久 URL，回答链接必须指向具体回答；
    - 只提取标题、最小来源、rank、sessionId 和获准的 DOM 可见最小标签；
    - 不保存正文、完整摘要、用户资料、评论、Cookie、Token；
    - 支持初始结果、动态加载、SPA query 切换、去重、节点替换和 cleanup；
    - 跳过广告、用户、无稳定 URL 和异常卡片；
    - 使用共享 Site Runtime/binding/collectors，所有选择器只在 Zhihu Adapter；
    - 不影响 Bilibili/Demo。

    测试必须通过显式依赖注入或专属 registry fixture 启动模块，不得为了测试
    临时改共享 Registry/Manifest。

    完成后运行专项和全仓测试，输出候选改动清单、建议的共享接线清单和真实
    Chrome 未验证项。状态写 READY_FOR_INTEGRATION，不得声称任务 13 已完整完成。

## 12. A-8：任务 14A——知乎原生标签专属模块

    任务名称：并行实现任务 14 的知乎专属标签模块，状态只能达到 READY_FOR_INTEGRATION。

    先核对 B-0 的知乎只读审计和用户权限决定。若审计缺失、页面结构已变化或
    需要新域名，停止并重新报告，不得自行扩大权限。

    要求：
    - 优先使用搜索卡片 DOM 中已有话题/标签；
    - 只对达到共享富化门槛的 Candidate 调用 Provider；
    - 不抓取完整回答/文章正文；
    - 不读取登录 Cookie、Token 或页面私有状态；
    - 若只能依赖登录、签名或不稳定私有接口，明确采用本地 fallback；
    - QUESTION、ANSWER、ARTICLE 使用共享 TagProfile；
    - 缓存、并发合并、退避、fallback 和删除级联复用任务 8；
    - 不修改评分、Side Panel、其他站点或共享接线冻结文件。

    只修改知乎 Provider、fixture 和专属测试。完成后给出 READY_FOR_INTEGRATION
    报告及所需权限/接线清单，不得声称任务 14 已在真实 Runtime 闭环完成。

### G3：平台模块交接

A-7/A-8 与 B-2/B-3 均完成后，双方停止编码。用户应：

1. 确认四组专属模块各自测试通过；
2. 确认两条分支均基于同一 A-6 契约提交；
3. 把 B 线提交和完成报告交给 A 线；
4. 指定 A 线独占共享接线文件；
5. 其他人不得同时改这些文件。

## 13. A-9：知乎/抖音共享接线与任务 13～16 完成判定

    任务名称：串行整合知乎与抖音专属模块，完成统一 Runtime 接线和验收。

    前提：
    - 当前工作树已包含 A、B 两线专属模块；
    - 工作树干净，无未解决冲突；
    - 用户已批准两个站点精确 host/content-script 范围及任何标签数据域名；
    - 本阶段只有本 AI/开发者修改共享接线文件。

    先只读比较两条线：
    - 是否遵守 A-6 共享契约；
    - 是否存在重复类型、Provider 或 Runtime；
    - 是否把选择器泄漏到 generic runtime；
    - 是否包含未经批准权限/网络；
    - 是否仍能独立通过专属测试。

    然后统一修改：
    - manifest.json 的精确多站点 matches/resources；
    - content/contentScript.js 的站点无关入口选择；
    - content/adapters/registry.js；
    - 必要的通用 Runtime 最小兼容；
    - scripts/validate-build.js、build/release 测试；
    - README、architecture、data-contract、permissions/privacy；
    - manual browser checklist；
    - canonical roadmap 的任务 9、13、14、15、16 状态和验证记录。

    约束：
    - 不使用 all_urls；
    - 不读取 Cookie/Token/正文/评论/用户资料；
    - 不顺手修改已冻结评分；
    - Bilibili、Demo 不回归；
    - fixture/mock 通过不等于真实站点闭环；
    - 未完成真实 Chrome 验收的站点只能标 PARTIAL/有条件完成，不能伪标 COMPLETED。

    自动验收：
    三站点 registry 唯一匹配、初始/动态/SPA/click/cleanup、标签 fallback、
    多 tab owner、恢复 finalize、跨平台 Re-encounter、权限拒绝测试、全仓
    syntax/node/npm/typecheck/build/diff check。

    手动验收：
    按站点分别记录 URL、Chrome 版本、初始/动态候选、点击方式、SPA、多标签、
    强制退出恢复、Context 跟随、标签来源、fallback、跨平台重逢和 Console。

    完成后输出一份可供 B-4 使用的集成交接报告。不要执行任务 17，不要 commit/push。

## 14. A 线完成报告模板

    阶段编号与名称：
    开始 HEAD：
    预期前置提交：
    结束时工作树状态：

    实际完成：
    -

    修改文件：
    -

    明确未修改的共享文件：
    -

    用户批准项：
    -

    自动验证：
    - 专项测试：
    - node --test：
    - npm test：
    - typecheck：
    - build：
    - git diff --check：

    真实 Chrome：
    - 已验证：
    - 未验证：

    权限/网络变化：
    -

    给 B 线或串行集成人的契约/提交信息：
    -

    当前状态：
    - COMPLETED / READY_FOR_INTEGRATION / BLOCKED

    下一阶段：
    -

## 15. 最终提醒

- A 线不能在 B 线仍修改共享文件时执行 A-9。
- B 线任务 17 开始后，A 线不得继续修改仓库；发现问题由 B 线只读报告，再由用户另开修复阶段。
- 两个人不得在同一工作目录工作；应使用不同 clone 或不同 Git worktree。
- 每次交接必须以 commit hash 为准，不能以“我的 AI 说做完了”为准。
- 若时间不足，优先保证任务 7～12 和 Bilibili 任务 9 的真实可靠性；知乎/抖音可如实降级为未完成，不能用静态 fixture 冒充真实支持。
