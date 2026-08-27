# 浏览器人工检查表

本表用于比赛提交前的真实 Chrome 验收。自动测试只能验证模块逻辑，不能证明 Chrome Side Panel、页面生命周期、真实 DOM 和扩展重载行为已经通过。

建议每次验收记录 Chrome 版本、Commit/工作区状态、日期、执行人、结果和截图。发布压缩包或 Git tag 仍需团队单独确认。

## A. 干净安装

- [ ] 在一个新目录 clone/解压仓库，根目录可见 `manifest.json`。
- [ ] 打开 `chrome://extensions/`，开启开发者模式。
- [ ] “加载未打包的扩展程序”选择仓库根目录。
- [ ] 扩展卡片显示 The Unclicked（余路），版本与 `manifest.json` 一致。
- [ ] 扩展卡片没有加载错误；详情页只显示 `sidePanel` 和 Bilibili 搜索范围相关访问。
- [ ] 点击工具栏扩展按钮能打开 Side Panel。

失败时先查看：扩展卡片“错误”、Side Panel DevTools Console、扩展卡片中的 Service Worker 检查入口，以及目标页面 DevTools Console。

## B. 本地 Demo 完整闭环（连续三轮）

每轮都先做隔离重置，避免旧记录让数量判断失真：

1. 在 Side Panel 点击“清空全部本地数据”→“确认清空”。
2. 确认“当前记录”为 0；在“采集控制”确认采集已恢复。
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
- [ ] 刷新 Demo 或打开新的 Bilibili 搜索页；不应产生新业务记录。
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

## E. Service Worker 恢复与安全检查

- [ ] 在一次未结算 Session 产生信号后，从 `chrome://extensions/` 打开 Service Worker DevTools 并停止 Worker。
- [ ] 回到页面继续操作或结算；Worker 被消息唤醒后，累计信号不回退、Chosen 不变 Missed。
- [ ] 重复结算不会增加记录，说明幂等依赖 Repository 而非 Worker 内存。
- [ ] 扩展卡片的权限没有 `<all_urls>`、第二个 host、Cookie、tabs、scripting 或 webRequest。
- [ ] Network/Console 中没有扩展向后端、模型或遥测服务上传 Repository 数据。
- [ ] 业务文本渲染没有 HTML 注入；只打开 HTTP(S) Candidate URL。

## F. 比赛录屏脚本与事实核对

建议 3–4 分钟顺序：

1. **问题（20 秒）**：搜索历史只记住点击；余路关注“认真考虑但没点”的结果。
2. **闭环（60–90 秒）**：清空数据 → 打开 Demo → 点击第一条 → 推进 12 秒 → 结算 → Side Panel 只出现第二条 → 重复结算数量不变。
3. **解释（30 秒）**：展示“为什么被记录”；说明固定启发式使用累计可见/Hover/回看且点击候选被排除。
4. **重逢（30 秒）**：在相关 Context 展示最多 3 条，并展示“打开/稍后/不相关”。如果冷却导致现场没有卡片，使用预先录制但与当前版本一致的备用片段，不临时改阈值。
5. **隐私（20 秒）**：local-first，只有 Bilibili 搜索 host；演示暂停、单条删除和二次确认清空。
6. **限制（20 秒）**：P0 只支持一个真实站点；启发式未完成 5–10 人校准；Bilibili DOM 可能更新；运行时没有模型/Embedding。

录屏/答辩可以说：

- “P0 已打通本地 Demo 和一个真实站点 Adapter 的代码闭环。”
- “业务数据保存在扩展 IndexedDB，本版本没有后端或模型调用。”
- “点击候选在结算中明确排除，重复 finalize 由持久化 marker 保证幂等。”

未完成对应人工项时不要说：

- “支持所有搜索引擎/所有 Bilibili 页面”；
- “算法已经个性化或完成用户校准”；
- “完全不会误判”；
- “AI 理解了语义”或“使用了 Embedding”；
- “已连续三次通过”或“已在干净环境安装”，除非本表有当次记录。

## G. 发布签字

- [ ] `npm test`、`npm run typecheck`、`npm run build` 当次通过。
- [ ] `git diff --check` 通过。
- [ ] 文本、DOCX 和图片材料已检查密钥、个人信息和绝对开发机路径。
- [ ] README、视频、截图与当前 Manifest/代码一致。
- [ ] 团队已经明确确认是否创建压缩包、commit、tag 和 push。

