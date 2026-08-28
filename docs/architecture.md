# 技术架构

本文描述 The Unclicked（余路）P0 当前代码中的真实运行边界。根目录是 Chrome Manifest V3 unpacked extension，不存在转译后的 `dist/`。

## 总体数据流

```mermaid
sequenceDiagram
  participant Page as Demo / Bilibili 搜索页
  participant Adapter as Site Adapter
  participant Runtime as Content Runtime
  participant Worker as Service Worker
  participant Repo as Repository / IndexedDB
  participant Panel as Side Panel

  Page->>Adapter: 当前 DOM 与最小搜索情境
  Adapter->>Runtime: Candidate + 页面内 Element 绑定
  Runtime->>Worker: CANDIDATES_DISCOVERED
  Runtime->>Worker: SIGNALS_UPDATED / CANDIDATE_CHOSEN
  Worker->>Repo: 幂等合并 Session 与聚合快照
  Runtime->>Worker: SESSION_FINALIZE
  Worker->>Repo: 原子写 Chosen / Missed Path / finalization marker
  Panel->>Worker: MISSED_PATHS_QUERY / ACTIVE_CONTEXT_QUERY
  Worker->>Repo: 查询与重逢排序
  Worker-->>Panel: 经过验证的 DTO
```

## 运行入口

- `manifest.json`：冻结最低 Chrome 版本、唯一权限、Bilibili content script 和受限的 web-accessible module 图。
- `background/serviceWorker.js`：Side Panel 行为、消息入口、Repository 与业务用例装配。
- `content/contentScript.js`：经典 content script 入口，只动态加载本地 `content/bilibiliRuntime.js`。
- `content/siteRuntime.js`：站点无关的真实页面会话生命周期、Candidate/Element binding、采集器、SPA 边界和结算编排；只依赖注入的 Site Adapter 接口。
- `content/bilibiliRuntime.js`：Bilibili 薄包装，负责创建 Bilibili Adapter 并注入通用 Site Runtime，同时保留原有兼容导出。
- `demo/app.js` + `content/demoRuntime.js`：扩展内部 Demo 的确定性闭环。
- `sidepanel/index.html` + `sidepanel/app.js`：本地记录、情境化重逢、反馈和数据控制 UI。

## 模块边界

| 模块 | 当前职责 | 不承担的职责 |
| --- | --- | --- |
| Site Adapter | 判断页面、提取 `Candidate`/`SearchContext`、绑定卡片 Element、观察动态结果 | 评分、存储、Chrome 消息、UI |
| Event Collector | 聚合可见时长、Hover 时长/次数、回看次数、点击 | 键盘/表单采集、完整鼠标轨迹、直接存储 |
| Site/Demo Runtime | 管理会话和绑定生命周期，发送严格消息，处理 SPA/页面退出结算 | 业务评分、IndexedDB、Side Panel 渲染 |
| Message Router / Use Cases | 校验消息、检查暂停状态、调用业务用例、返回统一响应 | 站点 DOM/选择器、UI 状态 |
| Session Manager / Scoring | Chosen 排除、考虑度结算、重逢排序和可解释 reasons | DOM、网络、模型 |
| Repository | schemaVersion、CRUD、单调快照、原子结算、级联删除 | 评分、页面解析、UI 文案 |
| IndexedDB Adapter | 在一个对象仓库中提交 puts/deletes/clear | 业务解释与跨设备同步 |
| Side Panel | 通过消息读取 DTO、展示、反馈、暂停、删除/清空 | 直接访问 Repository/IndexedDB、自行计算分数 |

## 两条运行线

### 本地 Demo

`demo/index.html` 是扩展内部页面，不需要 host permission。Demo Adapter 只读取 `data-demo-*` fixture；`demoRuntime` 复用 Candidate 绑定和采集器，然后通过与真实站点相同的消息与 Repository 完成结算。

“推进场景”显式增加 12 秒候选聚合信号，并在该窗口之后加入一个低信号动态候选。“结束会话”走正式 `SESSION_FINALIZE`，不是直接写 mock Missed Path。

### Bilibili 搜索页

唯一匹配范围是 `https://search.bilibili.com/*`。Adapter 只识别含 `keyword` 的 HTTPS 搜索 URL，并只在 `.video-list .bili-video-card` 中读取标题和 `www.bilibili.com/video/BV...` 链接。

Runtime 支持：

- 初始 Candidate 提取和动态新增；
- 同一搜索词下增量合并；
- 搜索词变化时先结算旧 Session，再启动新 Session；
- 普通左键、Ctrl/Cmd+左键和中键选择归因；
- `visibilitychange`、`pagehide`、`beforeunload` 时刷新聚合快照或结算；
- Worker 休眠/重启后从 Repository 恢复，不依赖 Worker 内存保存业务状态；
- 暂停状态、选择器失效、离开支持范围时安全停止或拒绝写入。

## 持久化与恢复

Repository 使用扩展 origin 下的 IndexedDB 数据库和单一 `repository-records` 对象仓库。每条记录有 `schemaVersion: 2` 包装；合法 v1 记录会在首次 Repository 访问时通过一次存储事务原子、幂等升级，未知版本或无元数据的非空库明确报错。

关键恢复不变量：

- Candidate 信号以累计快照发送；Repository 按字段取单调最大值，迟到快照不能回退计数。
- 点击状态只能从 `false` 变为 `true`。
- Session finalization marker、Chosen 和 Missed Path 在同一 Repository commit 中写入。
- 重复 finalize 读取持久化 marker 并返回同一结果，不重复产生记录。
- 活动搜索情境持久化，Side Panel 不依赖仍存活的 content script 才能查询。

## 安全与最小权限

站点选择器只存在于对应 Adapter；DOM Element 只存在于页面内存的绑定表。所有消息在 `shared/messages.js` 中做 schemaVersion、精确键和 payload 校验，所有领域记录在 `shared/types.js`/Repository 再校验。

Side Panel 用 `textContent` 写入业务文本，并在打开 URL 前进行 HTTP(S) 规范化；没有把业务数据拼接到 `innerHTML`。扩展没有远程脚本、网络客户端、后端或模型调用。

## 设计上的已知限制

- Service Worker 与页面生命周期事件存在浏览器时序差异，自动测试不能替代真实 Chrome。
- Bilibili DOM 类名更新需要只在 Adapter 内调整并重新验证。
- P0 固定启发式和关键词匹配尚未通过目标用户样本校准。
- Demo fixture 证明的是代码闭环，不证明真实站点覆盖率或用户价值。
