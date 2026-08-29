# 权限与隐私

The Unclicked 是 local-first 扩展。业务数据只写入扩展自身 origin 的 IndexedDB，没有后端、账号、遥测、云同步、远程脚本、模型调用或扩展主动发起的数据上传。

## Manifest 逐项说明

当前 `manifest.json` 的权限面应精确保持如下：

| 声明 | 必要性 | 代码证据/边界 |
| --- | --- | --- |
| `permissions: ["sidePanel"]` | 提供 Side Panel，并在点击扩展 action 时打开 | `background/serviceWorker.js` 调用 `chrome.sidePanel.setPanelBehavior`；不授予网页读取权限 |
| `host_permissions: ["https://search.bilibili.com/*"]` | 唯一显式 host permission | 只覆盖 Bilibili 搜索 hostname；没有知乎 host permission、`www.bilibili.com` 或 `<all_urls>` |
| Bilibili `content_scripts.matches: ["https://search.bilibili.com/*"]` | 在 Bilibili 搜索页的 `document_idle` 启动入口 | 入口为 `content/contentScript.js` |
| 知乎 `content_scripts.matches: ["https://www.zhihu.com/search*"]` | 在知乎搜索路径启动入口；Adapter 只接受内容搜索 | 不在问题、回答、文章详情页运行；不授予后台 fetch/Cookie 权限 |
| 抖音 `content_scripts.matches: ["https://www.douyin.com/search/*"]` | 在精确抖音搜索路径启动入口 | 不声明抖音 host permission，不在主页或详情页运行，不授予后台 fetch/Cookie 权限 |
| 三个平台对应 origin 的 `web_accessible_resources` | 允许各入口动态导入明确列出的本地 ES Modules | WAR 按 Chrome 规则只能限定到 origin，但不会令 Content Script 在其他路径运行；不允许远程代码或资源通配 |

没有声明：

- `storage`：Repository 使用扩展 origin 的 IndexedDB，不使用 `chrome.storage`；
- `tabs`、`activeTab`、`scripting`：不枚举标签页或向任意页面注入；
- `cookies`、`webRequest`：不读取身份状态或拦截流量；
- 通配 host、可选 host、知乎或抖音 host permission。

## 保存什么

为实现会话恢复、可解释 Missed Path 和情境化重逢，P0 本地保存：

- 搜索 Context：搜索词、拆分关键词、来源和时间；
- Candidate：站点候选 ID、标题、规范化 HTTP(S) URL、来源、排名和 Session ID；
- 聚合信号：候选级可见时长、Hover 时长/次数、回看次数和是否点击；
- 业务记录：Session、活动 Context、finalization marker、Chosen、Missed Path 分数/原因/状态；
- 重逢展示及“打开/稍后/不相关”反馈；
- Settings，包括采集开关和 P0 阈值。

搜索词、标题和 URL 可能反映用户兴趣，虽然它们只在本地保存，仍应视为需要用户控制的数据。

## 不保存什么

P0 不采集或持久化：

- 键盘事件、用户输入过程、表单字段或密码；
- Cookie、Token、登录态或请求头；
- 完整网页正文、回答/文章摘要或正文、评论、弹幕、视频内容、截图；
- 指针坐标、逐点鼠标轨迹或原始高频事件日志；
- DOM Element 或可序列化的页面节点；
- 设备指纹、账号资料或跨站浏览历史。

采集器只对 Adapter 明确绑定的候选卡片计算累计值。扩展源代码没有 `fetch`、XHR、WebSocket 或第三方运行时 SDK。

## 用户控制

### 暂停与恢复

打开 Side Panel，在“采集控制”选择“暂停采集”或“恢复采集”。暂停状态会保存到 Settings；后台拒绝新的 Candidate、信号、点击和结算写入。已有数据仍可查看和删除。

### 单条删除

在 Missed Path 卡片底部点击“删除记录”。Repository 会在同一次 commit 中删除该 Missed Path 以及所有引用它的 Re-encounter 历史。Chosen 和其他 Missed Path 不受影响。

### 清空业务数据

点击“清空全部本地数据”，再点击“确认清空”。这会清除 Session、活动 Context、finalization marker、Chosen、Missed Path 和 Re-encounter；Repository schema 元数据与当前 Settings 会保留。

因此 UI 文案中的“全部”指全部业务记录，不是浏览器 origin 的每个字节。若需连 Settings 一起完全移除，可在 `chrome://extensions/` 移除扩展，或使用该扩展 DevTools 的 Application/Storage 清理功能。

## 数据保留与传输

- 当前版本没有账号或跨设备同步，也没有自动上传路径。
- 当前 P0 没有按天自动过期；记录保留到用户删除、清空或浏览器清理扩展数据。
- Bilibili/知乎/抖音页面本身的网络行为由网站负责；The Unclicked 不把 Repository 数据发送给平台。
- 知乎任务 14 未增加网络 Provider：搜索卡片无可见话题，详情页话题来源需要整页访问或登录/Bearer 凭据，因此只保存标题/搜索词派生的本地 TagProfile。
- 抖音任务 15 只读取搜索卡片的最小候选字段和肉眼可见 hashtag；没有 hashtag 时使用本地 fallback，不发起平台 API 请求。
- 点击“打开”会导航到已有候选 URL，这是用户操作，不是后台数据上传。

## 发布前隐私检查

每次比赛提交候选版本应确认：

1. Manifest 仍只有 `sidePanel`、唯一 Bilibili host permission、三个精确搜索入口和对应受限 WAR；没有知乎/抖音 host permission 或 `<all_urls>`。
2. 没有 `.env`、密钥、Token、个人路径、抓包/日志或真实个人数据进入仓库。
3. 运行 `npm run build`，使发布静态校验扫描文本文件、环境文件名和调试/压缩产物。
4. 对二进制 Word/图片材料另做元数据与正文检查；文本扫描不能证明压缩文档内部无个人元数据。
5. 若新增权限、站点、依赖、网络或上传能力，先停止发布并进行新的授权与隐私审查。

