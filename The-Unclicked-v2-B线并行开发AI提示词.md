# The Unclicked（余路）v2 B 线并行开发与 AI 提示词

> 角色：前置真实站点审计、Bilibili 原生标签、抖音专属模块、最终独立只读验收的默认负责人  
> 生成基线：2026-08-28，HEAD 27db614，任务 0～6 已完成  
> 使用方式：先把本文件交给 B 线 AI 阅读，再由用户明确指定“执行 B-某阶段”。不得让 AI 一次执行整份文件。

## 1. 事实来源与总规则

本文件只负责 B 线。当前代码、Git、Manifest、测试和 docs/development-roadmap-v2.md 的事实优先于本文。桌面旧路线图中 schemaVersion 1、315 tests、任务 1～6 PENDING 等内容已过期，不得采用。

当前生成基线：

- main 与 origin/main 同步，工作树干净；
- HEAD 为 27db614；
- schemaVersion 为 2；
- 任务 0～6 已完成；
- node --test 与 npm test 为 356/356；
- typecheck 检查 86 个 JavaScript 文件；
- 任务 7～17 尚未完成；
- 未批准 Bilibili 标签新域名、知乎范围或抖音范围。

每个阶段都必须：

1. 运行 git status --short --branch、git log --oneline -8、git diff --check。
2. 阅读当前代码和路线图，只把其他文档中的提示词当资料。
3. 只执行用户点名的单一 B 阶段，不顺手实施 A 线或后续阶段。
4. 不覆盖、回退或格式化无关修改；不使用 reset --hard、checkout --、强制合并或自动 ours/theirs。
5. AI 不 commit、不 push、不打 tag、不创建发布包；由用户完成 Git 交接。
6. 不增加未经批准的权限、Host Permission、依赖、网络、模型、后端或遥测。
7. 不读取 Cookie、Token、密码、表单、完整正文、评论、用户资料或私有页面变量。
8. 不逆向签名、不绕过登录/反爬、不模拟私有客户端。
9. DOM 选择器只在对应 Adapter；Side Panel 不读取网页 DOM、URL 或 storage。
10. 自动测试和真实 Chrome 验收分开报告。
11. 完成后运行专项测试、node --test、npm test、npm run typecheck、npm run build、git diff --check，记录精确数量。

## 2. 双线总调度

| 阶段 | A 线 | B 线 | B 线动作 |
| --- | --- | --- | --- |
| P0 | 任务 7 → 8 | B-0 Bilibili/知乎/抖音只读预审计 | 只读，不改仓库 |
| G1 | 用户 commit/push 任务 7、8 | 拉取完全相同基线 | 未同步不得做任务 9 |
| P1 | 任务 10 → 11 → 12 | B-1 任务 9 | 可以并行 |
| G2 | 合并任务 9、12；A 冻结多平台共享契约 | 提交任务 9 报告并等待 | 不创建另一套契约 |
| P2 | 知乎专属模块 | B-2 抖音 Adapter → B-3 抖音标签模块 | 只改抖音专属文件 |
| G3 | A 独占共享接线 | 停止编码，提供提交/报告 | 不改 Manifest/Registry |
| P3 | 配合人工验证 | B-4 任务 17 最终只读验收 | 只读，不修复 |

## 3. B 线禁止事项与串行关口

### 3.1 G1 前不能写标签基础设施

任务 8 依赖任务 7，均由 A 线串行完成。B 线不得在自己的分支预先创建 shared/tags.js、TagProfile validator、Repository tag schema 或 Provider 接口。

### 3.2 B 线不修改 canonical roadmap

并行期间 docs/development-roadmap-v2.md 由 A 线统一维护。B 线每个阶段只输出完成报告，由 A 线在同步关口写入路线图。B 线可以修改自己任务明确要求的 permissions/privacy、fixture 和测试文档，但不能修改 canonical roadmap。

### 3.3 权限必须由用户批准

只读审计可以提前完成。任何真实实现前，都要把精确域名、URL pattern、请求字段、调用频率、缓存、失败模式、替代方案和隐私影响交给用户。用户未明确批准时必须停在 BLOCKED。

### 3.4 P2 共享文件冻结

B-2、B-3 期间禁止修改：

- manifest.json；
- content/contentScript.js；
- content/adapters/registry.js；
- scripts/validate-build.js；
- tests/build/validateBuild.test.js；
- README.md 的多站点说明；
- docs/architecture.md、docs/data-contract.md；
- docs/permissions-and-privacy.md；
- docs/manual-browser-checklist.md；
- docs/development-roadmap-v2.md。

这些文件由 A 线在 G3 后单人统一接线。B 线只能给出建议 diff 清单。

### 3.5 不得自行发明多平台字段

任务 13/15 要求 platform、contentType、layoutType、nativeTags，而当前 DTO 是严格结构。必须等待 A 线完成共享契约冻结。若抖音模块需要契约中不存在的字段，停止并提交需求，不得自行修改 shared/types/messages 或 Repository schema。

### 3.6 任务 17 只能一人执行

默认由 B 线执行最终只读验收，利用没有参与共享接线的视角发现问题。任务 17 开始后 A 线停止修改仓库；B 线发现缺陷只报告，不直接修复。

## 4. B-0：三平台提前只读审计

这一阶段与 A-1/A-2 同时进行，目的是利用等待时间。只读，不修改任何仓库文件、权限或浏览器数据。

### B-0A：Bilibili 原生标签审计提示词

    任务名称：只读审计 Bilibili 视频 Candidate 的原生标签来源，为任务 9 提供
    权限决策材料。

    只读检查当前代码、当前真实 Bilibili 搜索页和官方/公开资料。信息可能变化，
    必须以当前日期验证；技术事实优先使用平台公开页面、浏览器实际 Network/DOM
    和官方资料，不使用不明博客作为唯一证据。

    回答：
    - 搜索卡片 DOM 是否已经包含稳定可见标签；
    - Candidate 稳定视频 ID 如何映射标签；
    - 是否存在无需 Cookie、Token、登录私有状态、签名或模拟客户端的公开端点；
    - 精确请求域名、方法、最小请求/响应字段；
    - 每个符合富化门槛候选的最大调用数、缓存键、TTL 和失败退避建议；
    - 是否需要新增 host_permission；
    - 纯 DOM、本地标题 fallback、公开端点三种方案的可靠性与隐私比较。

    禁止：
    修改仓库、Manifest、浏览器存储；发送批量请求；登录绕过；读取 Cookie/Token；
    逆向签名；抓取正文、评论、用户资料、播放历史。

    若需要权限，输出精确域名和最小 pattern 后停止。不要实施任务 9。

### B-0B：知乎搜索范围与标签审计提示词

    任务名称：只读审计知乎搜索页，为任务 13、14 冻结最小 URL/DOM/权限范围。

    使用当前真实页面验证：
    - 精确搜索 URL、hostname、query 参数和 SPA 行为；
    - QUESTION、ANSWER、ARTICLE 的稳定卡片边界、永久 URL 和可区分字段；
    - 动态加载、重复节点、广告、用户结果及异常卡片；
    - 页面可见话题/标签是否足够；
    - 是否存在无需 Cookie/Token/登录/签名的稳定公开标签来源；
    - 最小 content-script match、host_permission 和 web-accessible resource 范围；
    - 登录、验证码、地区限制或 DOM 不稳定风险。

    不读取回答/文章正文、评论、用户资料、Cookie、Token 或私有变量；不修改仓库。

    输出精确建议和替代 fallback。任何权限都只建议，不实施，等待用户批准。

### B-0C：抖音搜索范围与标签审计提示词

    任务名称：只读审计抖音搜索页，为任务 15、16 冻结最小 URL/DOM/权限范围。

    使用当前真实页面验证：
    - 精确搜索 URL、hostname、query 参数、登录要求和 SPA 行为；
    - VIDEO 与 IMAGE_POST 的稳定卡片/永久 URL/内容类型字段；
    - 用户、话题、直播、商品、广告的排除依据；
    - 列表/网格/大卡片 layoutType 的可识别方式；
    - DOM 可见 hashtag 是否足够作为 nativeTags；
    - 是否存在无需 Cookie/Token/签名/模拟客户端的公开数据源；
    - 最小 content-script match、host_permission 和资源范围；
    - 验证码、登录、反爬和 DOM 波动风险。

    不播放或下载内容，不读取正文、评论、用户资料、Cookie、Token；不逆向签名，
    不修改仓库。

    如果页面必须登录或结构无法稳定识别，明确建议任务 15/16 暂停或采用
    DOM hashtag + 本地 fallback，不得绕过。

### B-0 统一输出格式

    平台：
    审计日期与 Chrome 版本：
    实际验证 URL：
    登录/验证码状态：
    DOM 可用事实：
    公开端点事实：
    建议权限：
    不申请权限时的 fallback：
    隐私影响：
    可靠性风险：
    推荐方案：
    需要用户确认的问题：

B-0 完成后把报告交给用户和 A 线。不要写入仓库，不要开始任务 9。

## 5. G1：等待任务 7、8 共同基线

B-1 只能在以下条件全部满足后开始：

- 用户提供包含任务 7、8 的 commit hash；
- B 线拉取该提交后工作树干净；
- 全仓测试通过；
- TagProvider 接口、富化门槛和 Repository TagProfile 已存在；
- 用户已对 Bilibili 权限方案作出明确决定。

如果任一条件不满足，停止并报告，不得补写 A 线代码。

## 6. B-1：任务 9——Bilibili 原生标签

    任务名称：执行 v2 任务 9，为达到富化门槛的 Bilibili Candidate 提供原生
    标签；严格使用 B-0 审计和用户批准结果。

    第一阶段核验：
    重新确认审计结论仍适用于当前页面和代码。如果需要任何未批准的新域名、
    endpoint、permission 或数据字段，列出精确影响并停止。

    实施要求：
    - 复用任务 8 的 TagProvider、缓存、并发合并、退避和本地 fallback；
    - 只为达到集中富化门槛的 Candidate 调用；
    - 按稳定 BV 视频 ID 去重；
    - 优先使用获准的 DOM 可见标签；只有获准时才使用公开端点；
    - 不请求正文、评论、用户资料、播放历史；
    - 不读取 Cookie、Token、登录私有状态或页面私有变量；
    - 不逆向签名、不绕过反爬、不增加依赖；
    - 失败退回搜索词/标题标签，不阻塞 checkpoint/finalize；
    - 不修改评分、Re-encounter、Side Panel、Session Manager 或第二站点；
    - 不修改 docs/development-roadmap-v2.md，由 A 线统一更新。

    允许修改：
    - Bilibili 专属 TagProvider/fixture/测试；
    - 任务 8 预留的 provider registration 最小接线；
    - 经用户批准的 manifest.json 精确权限；
    - scripts/validate-build.js 和对应 build test；
    - docs/permissions-and-privacy.md 的真实权限说明；
    - 必要 Bilibili Runtime/Adapter 最小标签入口，但不得移动选择器到通用层。

    验收：
    未达门槛零调用、同 BV 并发合并、缓存、退避、端点失败 fallback、暂停采集、
    Worker 重启、删除/清空、敏感字段拒绝、精确权限、Bilibili Runtime/Demo/全仓
    无回归，以及真实 Chrome 最小调用验证。

    完成后输出完整报告和供 A 线写入路线图的建议文字。不要开始抖音任务，
    不要 commit/push。

## 7. G2：等待评分主干与共享多平台契约

B-2 开始前必须：

1. 用户审查并 commit/push B-1；
2. A 线完成任务 10、11、12；
3. 用户把任务 9、12 合并到同一干净基线；
4. A 线完成“多平台共享契约冻结”并 commit/push；
5. B 线从该确切 commit 创建独立分支/worktree；
6. 用户已批准抖音精确范围，或明确选择 fallback-only 方案。

没有 A 线共享契约时，禁止先写抖音 DTO、消息或 Repository 字段。

## 8. B-2：任务 15A——抖音专属 Adapter/Runtime 模块

    任务名称：并行实现任务 15 的抖音专属模块，状态只能达到 READY_FOR_INTEGRATION。

    前提：
    - 当前代码包含 A 线冻结的多平台共享契约；
    - 用户已批准精确抖音搜索 URL、content-script match 和 host permission；
    - 目标页登录/验证码状态符合 B-0 的可实现结论；
    - 本阶段禁止修改共享接线冻结清单。

    实现：
    - 新建抖音 Adapter、必要薄 Runtime、fixture 和专属测试；
    - 只支持 VIDEO 和 IMAGE_POST；
    - 排除用户、话题、直播、商品、广告；
    - 使用共享 Site Runtime、binding、visibility、hover、click、checkpoint；
    - 所有选择器只在 Douyin Adapter；
    - 使用已冻结的平台/类型命名空间 ID 和永久 URL；
    - 只读取标题、最小来源、rank、sessionId、layoutType 和获准的可见 hashtag；
    - 不读取视频/图文正文、评论、用户资料、Cookie、Token；
    - 支持初始、动态加载、SPA query 切换、节点替换、重复去重和 cleanup；
    - 所有点击方式不阻止默认导航；
    - 不影响 Demo、Bilibili、知乎专属模块。

    测试通过显式注入或专属 registry fixture 启动，不修改 Manifest、
    content/contentScript.js 或公共 registry。

    如果真实页面必须登录、选择器无法稳定识别或永久 URL 不可靠，停止并报告，
    不用 fixture 冒充真实闭环。

    完成后运行专项和全仓测试，输出 READY_FOR_INTEGRATION 报告、共享接线建议
    和真实 Chrome 未验证项。不得声称任务 15 已完整完成。

## 9. B-3：任务 16A——抖音原生标签专属模块

    任务名称：并行实现任务 16 的抖音专属标签模块，状态只能达到 READY_FOR_INTEGRATION。

    以 B-0 审计和用户批准为边界：
    - 优先使用 DOM 可见 hashtag；
    - 只有达到任务 8 富化门槛才进入 Provider；
    - 没有公开稳定端点时使用 hashtag + 标题/搜索词 fallback，这不是失败；
    - 不逆向签名、不读取 Cookie/Token、不模拟客户端；
    - 不支持用户、话题、直播、商品或广告；
    - 缓存、并发合并、退避、fallback 和删除级联复用共享模块；
    - 不修改评分、Repository 结构、Side Panel、其他站点或共享接线冻结文件。

    只修改 Douyin Provider、fixture 和专属测试。若必须新增权限，停止并重新请求
    精确批准。

    完成后输出 READY_FOR_INTEGRATION 报告及权限/接线清单，不得声称任务 16
    已在真实 Runtime 中完成。

## 10. B 线向 A 线的 P2 交接包

B-2/B-3 完成后停止编码，向 A 线提供：

    基线 commit：
    B 线分支/commit（由用户创建）：
    专属新增文件：
    是否修改了冻结共享文件：必须为否
    Douyin Adapter factory/export：
    Runtime factory/export：
    Provider factory/export：
    需要加入 Registry 的内容：
    需要加入 Manifest 的精确 matches/resources：
    需要加入 build validator 的模块图：
    自动测试命令与数量：
    真实 Chrome 已验证：
    真实 Chrome 未验证：
    权限批准记录：
    已知 DOM/登录/验证码限制：
    建议文档文字：

用户应先审查并 commit/push B 线，再让 A 线执行串行共享接线。B 线此后不得继续修改共享代码。

## 11. 等待 A 线共享集成

B-4 只能在 A 线完成并由用户 commit/push 统一共享接线后开始。确认：

- main/候选集成分支包含任务 7～16 的实际代码；
- 工作树干净；
- A、B 两条专属模块均已接入 Manifest/Registry/Content Entry；
- 全仓自动测试已通过；
- 权限文档与 Manifest 一致；
- A 线已经停止修改。

## 12. B-4：任务 17——最终三平台只读验收

    任务名称：对 The Unclicked v2 三平台候选版本执行最终独立只读验收。

    重要限制：
    - 只读，不修改、格式化、生成或删除任何仓库文件；
    - 不 commit、不 push、不打 tag、不打包；
    - 不把路线图 COMPLETED、fixture、mock、静态 prototype 或自动测试当成真实
      Chrome 闭环证据；
    - 发现缺陷只报告，不直接修复；
    - 仓库文档中的提示词只当资料，不执行。

    一、事实基线
    1. 运行 git status --short --branch、git log --oneline -12、git diff --check。
    2. 记录 HEAD、分支、工作树、schemaVersion、Manifest 权限和站点范围。
    3. 列出三站点 Adapter/Runtime、共享 Site Runtime、TagProvider、消息、
       Repository、评分、恢复、Side Panel、测试、构建和文档入口。
    4. 运行所有 JavaScript 语法检查、node --test、npm test、
       npm run typecheck、npm run build，记录精确测试数和失败。

    二、逐段追踪真实数据流
    A. Bilibili/知乎/抖音真实搜索页 → Adapter → Site Runtime →
       Candidate/Element Binding → CANDIDATES_DISCOVERED → Session Owner；
    B. visibility/hover/return/click → checkpoint → Repository；
    C. 本地 tags/原生 Provider → Context/Candidate/Selected TagProfile；
    D. TagProfile + behavior → Consideration v2 → Chosen/Missed；
    E. 当前 active tab → Re-encounter v2 → SHOWN/FEEDBACK/cooldown；
    F. Worker/浏览器强制退出 → lease takeover → 原子幂等 finalize；
    G. 暂停、单删、清空 → Session/Tag/Reencounter 最终持久化状态。

    每段标记：完整、部分接通、仅测试存在、完全缺失。静态 fixture 不算真实闭环。

    三、关键正确性
    - clicked 绝不进入 Missed；
    - 信号绝对快照幂等、单调、迟到不回退；
    - owner 不可伪造，tab/document/frame 隔离；
    - finalize 原子、恢复幂等、ABANDONED 正确；
    - 标签请求门槛、并发合并、缓存、退避、fallback 和删除级联；
    - 标签不能绕过最低行为门槛；
    - Consideration 使用用户批准值且与恢复路径一致；
    - Re-encounter 最多 1～3、可解释、冷却和负反馈正确；
    - 当前标签快速切换无迟到覆盖，SHOWN/FEEDBACK 不串 tab；
    - Side Panel 只消费 DTO，不访问 storage 或网页 DOM；
    - DOM 选择器只在对应 Adapter，Element 不进消息/存储。

    四、权限、隐私和安全
    - 每个 host/content-script/resource pattern 精确且有批准记录；
    - 无 all_urls、多余站点、tabs/activeTab/scripting/webRequest 等非必要权限；
    - 无 Cookie、Token、键盘、表单、密码、正文、评论、用户资料、鼠标轨迹；
    - 无远程代码、未声明依赖、密钥、env、真实个人数据或绝对开发机路径；
    - URL 协议白名单、消息 payload 严格校验、业务文本无 innerHTML 注入；
    - local-first、保存内容和删除语义与 README 一致。

    五、真实 Chrome 矩阵
    分别检查 Bilibili、知乎、抖音：
    - 精确支持 URL 和不支持页面；
    - 初始/动态/SPA/去重/cleanup；
    - 普通/Ctrl/Cmd/中键点击；
    - 两 tab 相同 query、不同 document、快速切 tab；
    - 强制退出、Worker 重启、重复 finalize；
    - 标签来源、fallback、网络失败；
    - 跨平台重逢、反馈、冷却；
    - 暂停、单删、清空。

    无法亲自执行的项目必须标“未验证”，不要猜测。列出用户可执行的具体步骤、
    预期和需要回传的截图/Console。

    六、比赛材料
    检查 README、运行说明、技术栈、环境、项目简介、第三方代码/API/AI 声明、
    视频/截图与真实能力一致。重点检查“开发起点证明”图片是否仍暴露本机路径
    或账号名。

    七、输出
    1. 可提交 / 有条件可提交 / 不可提交；
    2. P0 阻塞提交：证据、复现、风险、最小修复建议；
    3. P1 应修问题；
    4. P2 可接受限制及 README/答辩披露；
    5. 自动验证矩阵；
    6. 三平台手动验收矩阵；
    7. 权限和隐私矩阵；
    8. 比赛材料完整性；
    9. 按风险排序的最小修复顺序，但不要修改。

## 13. B 线完成报告模板

    阶段编号与名称：
    开始 HEAD：
    所依赖的 A 线基线 commit：
    结束时工作树状态：

    实际完成：
    -

    修改文件：
    -

    确认未修改的冻结共享文件：
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

    真实站点：
    - 已验证：
    - 未验证：

    权限/网络变化：
    -

    给 A 线的接线信息：
    -

    当前状态：
    - COMPLETED / READY_FOR_INTEGRATION / BLOCKED / READ_ONLY_AUDIT

    下一阶段：
    -

## 14. 最终提醒

- 两个人必须使用不同 clone 或 Git worktree，不能共享一个工作目录。
- 每次并行开始前必须交换共同基线 commit hash。
- B 线不能因为等待 A 线而越权实现 shared tags、Repository 或评分。
- B 线的 fixture 通过不等于抖音真实页面可用。
- 如果抖音必须登录、DOM 不稳定或公开标签源不可用，可以如实采用 fallback 或停止；不能绕过。
- 时间不足时优先保证任务 7～12 与 Bilibili 真实闭环。未完成的知乎/抖音必须如实标注，不能以静态模块冒充完整支持。
