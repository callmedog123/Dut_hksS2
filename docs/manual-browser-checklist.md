# 浏览器人工检查表

本表用于比赛提交前的真实 Chrome 验收。自动测试只能验证模块逻辑，不能证明 Chrome Side Panel、页面生命周期、真实 DOM 和扩展重载行为已经通过。

建议每次验收记录 Chrome 版本、Commit/工作区状态、日期、执行人、结果和截图。发布压缩包或 Git tag 仍需团队单独确认。

## A. 干净安装

- [ ] 在一个新目录 clone/解压仓库，根目录可见 `manifest.json`。
- [ ] 打开 `chrome://extensions/`，开启开发者模式。
- [ ] “加载未打包的扩展程序”选择仓库根目录。
- [ ] 扩展卡片显示 The Unclicked（余路），版本与 `manifest.json` 一致。
- [ ] 扩展卡片没有加载错误；详情页只显示 `sidePanel`、唯一 Bilibili 搜索 host permission，以及知乎/抖音精确搜索页访问。
- [ ] 点击工具栏扩展按钮能打开 Side Panel。

失败时先查看：扩展卡片“错误”、Side Panel DevTools Console、扩展卡片中的 Service Worker 检查入口，以及目标页面 DevTools Console。

## B. 本地 Demo 完整闭环（连续三轮）

每轮都先做隔离重置，避免旧记录让数量判断失真：

1. 在 Side Panel 点击“清空全部本地数据”→“确认清空”。
2. 确认“当前记录”为 0；在“采集控制”确认采集设置已恢复。若搜索页曾在暂停状态下保持打开，请刷新该搜索页。
3. 新开 Demo：`chrome-extension://<扩展 ID>/demo/index.html`。
4. 确认页面自动显示：
   - `PING/PONG 成功`；
   - `Demo Runtime 已启动，当前发现 2 个候选项`；
   - “推进场景”和“结束会话”可点击。
5. 普通点击、Ctrl/Cmd+点击或中键打开第一条 `Human Cognitive Map and Spatial Representation`。
6. 点击“推进场景（模拟 12 秒）”；确认出现 `Low-signal Dynamic Result`，按钮变为“场景已推进”。
7. 点击“结束会话”；确认状态为会话结算成功。
8. 重新打开或刷新 Side Panel：
   - “当前记录”从 0 变为 1，而不是 2；
   - 唯一新增卡片是 `Planning with Learned World Models`；
   - 第一条 Chosen 和低信号动态结果都没有成为 Missed Path。
9. 点击“再次结束会话（幂等）”，刷新 Side Panel，数量仍为 1。

| 轮次 | PING/启动 | 只新增 1 条 | 重复结算不增加 | Console 无阻塞错误 | 结果/截图 |
| --- | --- | --- | --- | --- | --- |
| 1 | [ ] | [ ] | [ ] | [ ] | |
| 2 | [ ] | [ ] | [ ] | [ ] | |
| 3 | [ ] | [ ] | [ ] | [ ] | |

只有三行全部通过，才能声明“Demo 完整闭环连续成功 3 次”。

## C. 数据控制

### 暂停/恢复

- [ ] 点击“暂停采集”，状态显示“采集已暂停”。
- [ ] 刷新 Demo 或打开新的 Bilibili/知乎/抖音搜索页；不应产生新业务记录。
- [ ] 已有 Missed Path 仍可查看和删除。
- [ ] 点击“恢复采集”后，新 Demo 能重新启动并写入。
- [ ] 若在暂停状态直接打开 Demo，页面可以显示明确的暂停失败信息；扩展卡片不应出现无法恢复的阻塞错误。

### 单条删除

- [ ] 先准备至少两条 Missed Path。
- [ ] 删除其中一张卡片，数量只减少 1；刷新/重开 Side Panel 后仍保持。
- [ ] 与被删除 Missed Path 关联的“情境化重逢”会消失，其他业务记录不应被删除。
- [ ] 如果当前重逢列表整体变化，先考虑 24 小时展示冷却和重新查询，而不要只凭上方卡片数判断删除范围。

### 清空业务数据

- [ ] 点击“清空全部本地数据”后出现二次确认；点“取消”不改变数据。
- [ ] 再次操作并确认后，Missed Path、情境化重逢和活动 Context 清空。
- [ ] 采集开关保持清空前状态；这是设计行为。
- [ ] 刷新/重开 Side Panel 后结果仍为空。

## D. Bilibili 真实搜索页

准备 URL 形如 `https://search.bilibili.com/all?keyword=<搜索词>`。本项受 Bilibili 当前 DOM 和网络状态影响。

- [ ] 只有 `search.bilibili.com` 且含非空 `keyword` 的页面启动 Runtime。
- [ ] 初始视频卡片被识别；空标题、坏链接、广告/非视频链接被安全跳过。
- [ ] 滚动触发动态加载后，新卡片进入同一 Session，不重复已有 Candidate。
- [ ] 对一条未点击卡片形成足够可见/Hover/回看信号；对另一条分别验证普通左键、Ctrl/Cmd+左键或中键归入 Chosen（至少覆盖现场要演示的手势）。
- [ ] 修改搜索词触发 SPA 切换时，旧 Session 先结算，新 Context/Session 再启动。
- [ ] 离开页面、切换页面可见性或刷新后，结算不会重复增加同一 Session 的记录。
- [ ] 打开 Side Panel 后，Missed Path 标题/URL/来源和“为什么被记录”与操作相符。
- [ ] 在相关新搜索情境中最多显示 3 条重逢；“为什么此刻重逢”可见。
- [ ] 重逢的“打开/稍后/不相关”反馈能保存；“稍后”更新冷却，“不相关”影响后续排序。
- [ ] 访问 Bilibili 首页、视频详情页或第二站点不会启动该 Runtime。

选择器失效的典型现象是页面有视频卡片但 Runtime 没有候选。此时记录当前 URL、DOM 截图和 Console，修复应限定在 `content/adapters/bilibiliSearchAdapter.js`，然后重跑 Adapter 测试和本表。

## E. 知乎真实搜索页

前置：用户自行在 Chrome 登录知乎。准备 `https://www.zhihu.com/search?type=content&q=<搜索词>`；不要在测试记录中保存账号资料、Cookie、Token 或私人搜索词。

- [ ] 扩展只在 `www.zhihu.com/search` 且 `q` 非空、`type=content`（或缺省）时采集；`type=people`、详情页和 `zhuanlan.zhihu.com` 详情页不启动 Runtime。
- [ ] 初始结果至少覆盖一个具体回答、一个问题和一篇文章；Candidate URL 分别是具体 `/answer/<id>`、问题永久 URL 和无 `zpf` 的 `zhuanlan.zhihu.com/p/<id>`。
- [ ] 用户、电子书、相关搜索、显式广告、空标题和异常链接均不进入 Candidate；不读取或保存结果摘要/正文。
- [ ] 滚动两批结果后动态卡片进入同一 Session，稳定 ID/永久 URL 不重复。
- [ ] 普通左键、Ctrl/Cmd+左键和中键均不阻止知乎默认导航，且具体 Candidate 归入 Chosen。
- [ ] 更换搜索词后旧页面 Session 最终只结算一次；新页面产生新的 Context/Session。
- [ ] 同一搜索词开两个标签页，分别操作后 Context、信号与结算不串 tab。
- [ ] 在未显式结束的 Session 产生信号后终止 Worker/关闭浏览器；再次启动后恢复结算不重复，clicked Candidate 不进入 Missed。
- [ ] 替换/移除结果节点或刷新页面后无重复监听；Console 无阻塞错误。
- [ ] Side Panel 展示 `zhihu-search`、正确内容类型、永久 URL 和 reasons；重逢仍最多 3 条。
- [ ] 搜索卡片不出现可见话题时使用本地标题/搜索词 fallback；Network 面板没有扩展发起的知乎详情页/API 请求，不声称已取得知乎原生话题标签。

任务 13 的开发审计确认了真实已登录搜索 DOM、三类永久 URL、广告/用户标记和滚动动态追加，但不能替代加载当前 unpacked extension 后逐项勾选本节。

## F. 抖音真实搜索页

前置：使用普通公开搜索页 `https://www.douyin.com/search/<搜索词>`；如果站点要求登录或触发人机验证，停止测试，不绕过登录或反爬。不要在测试记录中保存账号资料、Cookie、Token 或私人搜索词。

- [ ] 只有 `www.douyin.com/search/<非空搜索词>` 的综合/视频搜索启动 Runtime；用户搜索、主页、详情页、话题、直播、商品和广告不采集。
- [ ] 初始普通视频和图文作品分别得到 `douyin:video:<aweme_id>`、`douyin:image_post:<aweme_id>`，URL 为稳定 `/video/<id>` 或 `/note/<id>`，contentType 正确。
- [ ] 标题为空、ID 非法、内容类型无法确认、重复节点和异常卡片均被跳过。
- [ ] 滚动加载两批结果后新增 Candidate 进入同一 Session，重复节点不重复；更换搜索词时旧 Session 先结算，新 Session 再启动。
- [ ] 普通左键、Ctrl/Cmd+左键和中键均不阻止默认导航，并把对应 Candidate 归入 Chosen。
- [ ] 卡片中肉眼可见的 hashtag 进入 CandidateTagProfile；无 hashtag 的卡片使用标题/搜索词 fallback。Candidate DTO 本身不包含 `nativeTags`。
- [ ] 两个相同搜索词标签页的 Context、信号和结算不串 tab；刷新、节点替换和 cleanup 不产生重复监听或重复结算。
- [ ] Network 面板没有扩展发起的抖音 API、详情页或远程服务请求；扩展权限中没有抖音 host permission、Cookie、webRequest、tabs 或 scripting。
- [ ] Side Panel 可查询产生的 Missed Path 和最多 3 条跨平台重逢，标题、URL、来源、类型和 reasons 与操作一致。

任务 15 的自动测试和 fixture 不能证明真实抖音 DOM 当前仍兼容；本节未逐项勾选前只能声明“代码已接入，真实 Chrome 待验证”。

## G. Service Worker 恢复与安全检查

- [ ] 在一次未结算 Session 产生信号后，从 `chrome://extensions/` 打开 Service Worker DevTools 并停止 Worker。
- [ ] 回到页面继续操作或结算；Worker 被消息唤醒后，累计信号不回退、Chosen 不变 Missed。
- [ ] 重复结算不会增加记录，说明幂等依赖 Repository 而非 Worker 内存。
- [ ] 扩展卡片的权限没有 `<all_urls>`、知乎/抖音 host permission、Cookie、tabs、scripting 或 webRequest。
- [ ] Network/Console 中没有扩展向后端、模型或遥测服务上传 Repository 数据。
- [ ] 业务文本渲染没有 HTML 注入；只打开 HTTP(S) Candidate URL。

## H. 比赛录屏脚本与事实核对

建议 3–4 分钟顺序：

1. **问题（20 秒）**：搜索历史只记住点击；余路关注“认真考虑但没点”的结果。
2. **闭环（60–90 秒）**：清空数据 → 打开 Demo → 点击第一条 → 推进 12 秒 → 结算 → Side Panel 只出现第二条 → 重复结算数量不变。
3. **解释（30 秒）**：展示“为什么被记录”；说明固定启发式使用累计可见/Hover/回看且点击候选被排除。
4. **重逢（30 秒）**：在相关 Context 展示最多 3 条，并展示“打开/稍后/不相关”。如果冷却导致现场没有卡片，使用预先录制但与当前版本一致的备用片段，不临时改阈值。
5. **隐私（20 秒）**：local-first；唯一显式 host permission 是 Bilibili 搜索，知乎/抖音通过精确静态搜索入口运行；演示暂停、单条删除和二次确认清空。
6. **限制（20 秒）**：启发式未完成 5–10 人校准；三平台 DOM 可能更新；知乎原生标签因无安全公开来源而采用本地 fallback；运行时没有模型/Embedding。

录屏/答辩可以说：

- “当前代码已接入本地 Demo、Bilibili、知乎和抖音搜索 Adapter；真实 Chrome 能力只按本表当次勾选结果陈述。”
- “业务数据保存在扩展 IndexedDB，本版本没有后端或模型调用。”
- “点击候选在结算中明确排除，重复 finalize 由持久化 marker 保证幂等。”

未完成对应人工项时不要说：

- “支持所有搜索引擎或平台全部页面”；
- “算法已经个性化或完成用户校准”；
- “完全不会误判”；
- “AI 理解了语义”或“使用了 Embedding”；
- “已连续三次通过”或“已在干净环境安装”，除非本表有当次记录。

## I. 发布签字

- [ ] `npm test`、`npm run typecheck`、`npm run build` 当次通过。
- [ ] `git diff --check` 通过。
- [ ] 文本、DOCX 和图片材料已检查密钥、个人信息和绝对开发机路径。
- [ ] README、视频、截图与当前 Manifest/代码一致。
- [ ] 团队已经明确确认是否创建压缩包、commit、tag 和 push。

