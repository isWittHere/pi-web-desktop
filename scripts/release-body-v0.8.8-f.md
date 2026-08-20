Pi Web Desktop v0.8.8-f Major Update

一、新增功能
工作区标签页
浏览器式工作区标签栏：标题栏内每打开一个工作区一个标签，带运行圆点与关闭按钮 — 6c1e414
标签拖拽排序、跨重启持久化 — f91346b 8e09fba
设置 → 显示 → 视图模式：Classic / Tabs 一键切换 — d5f16f2
运行与未读状态指示（弧线 + 呼吸点）— 29a5ea9
4+ 标签时会话标题移至信息栏，标题栏完全让位标签条 — 1e20811
Tabs 模式下标题栏最左侧显示 Pi 标志 — b0b2264

欢迎大厅
多来源最近工作区欢迎大厅，顶部常用工作区下展开最近会话 — 19202fd 0ee481a
活动时间与来源标签、选择器动作 — b3cb359 addce19 77063f9
进入工作区自动恢复最新会话 — e2dd630
打开大厅会话时恢复工作树切换器 — b6f80a1
优化欢迎与空侧边栏状态 — 5d6d09c

壁纸与毛玻璃
聊天壁纸 + 主题色遮罩 — 4330f0a
跟随 Monet 主题的默认壁纸 — 61d6a67
全窗口壁纸上的分区域毛玻璃效果（侧边栏分组头、文件 chips）— fef768b bcce035
壁纸设置区重构、启动淡入修复 — 62ec261
面板分隔线与边缘渐变跨模式统一 — 9d88993

工具预设与会话统计
只读工具预设 — 8c84b22
会话统计显示平均缓存命中率 — c65f1c9

模型配置
supportsAdditionalTools 开关 — 6280b4a

二、功能改进
工作树切换器移入独立侧边栏面板，任何 git 顶层目录均显示 — 5100963 fb2f164
流式期间显示工具执行进度 — 8769a45
主题加载器规范化 search-match token — 82a6b00

三、问题修复
安全
隔离项目命令环境：宿主 PORT/NODE_ENV/NEXT_* 变量不再泄漏进 agent bash 命令 — daa39cf

会话与流式
瞬时会话在 JSONL 落盘前保持可访问 — 847b4a7
包装器关闭信号转发给 Next 子进程 — 2958308
打开会话不再出现加载遮罩 — 296a91b
强制刷新正确传递到会话列表路由 — eb46f78

渲染与模型
Markdown 表格 token 保持行内 — ed3a65b
拒绝模糊裸模型作用域、provider 响应防护、安全上报模型加载失败 — 21dd717 07f2447 5cf5d22

平台与界面
Electron 标题栏下拉外部点击关闭 — 28952a8
推荐列表打开工作区修复（跨分隔符路径匹配）— 55b8829 abc5f02
用户清除工作区后不再自动重选 — 97142f9
CSS zoom 下运行弧线旋转中心修复 — bfb31f6
i18n：无工具 / 只读预设标签消歧 — 972c7c9 645ca04

四、底层更新
pi SDK 0.84.1 → 0.84.2：Theme 构造器即时展开 searchMatchBg/searchMatchText 回退 — c0a754d
升级 next/undici 及相关依赖 — d2c6b7b
恢复最小依赖范围与 lockfile 源 — ad710f2

发布包：PiWeb-desktop-0.8.8-f-portable-win.zip（构建后上传）

---

Pi Web Desktop v0.8.8-f Major Update

1. New Features
Workspace Tabs
Browser-style workspace tab bar in the title bar: one tab per opened workspace with running dots and close buttons — 6c1e414
Drag-to-reorder, persisted across restarts — f91346b 8e09fba
Settings → Display → View mode: Classic / Tabs switch — d5f16f2
Running & unread indicators (arc + breathing dot) — 29a5ea9
Session title moves to the info bar at 4+ tabs, freeing the title bar for the tab strip — 1e20811
Pi logo pinned to the far left of the title bar in tabs mode — b0b2264

Welcome Lobby
Multi-source recent workspaces lobby, recent sessions expanded under top workspaces — 19202fd 0ee481a
Activity times, plain source labels and picker actions — b3cb359 addce19 77063f9
Latest session auto-restored when entering a workspace — e2dd630
Worktree switcher restored when opening a lobby session — b6f80a1
Improved welcome and empty-sidebar states — 5d6d09c

Wallpaper & Frosted Glass
Chat wallpaper with theme-colored scrim — 4330f0a
Theme-following Monet default wallpapers — 61d6a67
Per-area frosted-glass effects over a full-window wallpaper — fef768b bcce035
Wallpaper settings reworked, startup fade fixed — 62ec261
Panel dividers and edge fades unified across modes — 9d88993

Tool Presets & Session Stats
Read-only tool preset — 8c84b22
Average cache hit rate shown in session stats — c65f1c9

Model Config
supportsAdditionalTools toggle — 6280b4a

2. Improvements
Worktree switcher moved into a dedicated sidebar panel, shown for any git top-level — 5100963 fb2f164
Tool execution progress shown while streaming — 8769a45
Search-match theme tokens normalized in the theme loader — 82a6b00

3. Bug Fixes
Security
Project command environments isolated: host PORT/NODE_ENV/NEXT_* variables no longer leak into agent bash commands — daa39cf

Sessions & Streaming
Transient sessions stay accessible before the JSONL file is flushed — 847b4a7
Wrapper shutdown signals forwarded to the Next child — 2958308
Sessions open without the loading overlay — 296a91b
Force refresh passed through to the session list route — eb46f78

Rendering & Models
Markdown table tokens kept inline — ed3a65b
Ambiguous bare model scopes rejected; provider responses guarded; safe model load failures surfaced — 21dd717 07f2447 5cf5d22

Platform & UI
Outside-click dismissal of title-bar dropdowns in Electron — 28952a8
Opening workspaces from the recommended list fixed (cross-separator path matching) — 55b8829 abc5f02
No re-auto-select after the user cleared a workspace — 97142f9
Running-arc rotation center fixed under CSS zoom — bfb31f6
i18n: no-tools / read-only preset labels disambiguated — 972c7c9 645ca04

4. Underlying Updates
pi SDK 0.84.1 → 0.84.2: Theme constructor now eagerly expands searchMatchBg/searchMatchText fallbacks — c0a754d
next/undici and related deps upgraded — d2c6b7b
Minimal dep ranges and lockfile registry URLs restored — ad710f2

Package: PiWeb-desktop-0.8.8-f-portable-win.zip (upload after build)