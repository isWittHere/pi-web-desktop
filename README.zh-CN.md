# Pi Web Desktop

[English](./README.md)

<p align="center">
  <img src="./public/favicon.svg" alt="Pi Web Desktop" width="128" />
</p>

## 项目来源与目标

本项目基于上游 [pi-web](https://github.com/agegr/pi-web) 的 `v0.7.16` 版本继续开发，是面向 [pi 编程智能体](https://github.com/badlogic/pi-mono) 的桌面应用客户端。

项目保留 pi-web 的本地会话、模型、技能和文件工作区能力，并为桌面端重新设计了窗口、侧边栏、会话过程展示、文件预览与主题切换等交互。

## 使用方式

请从本项目 GitHub Releases 下载与你的系统匹配的桌面安装包或便携版，安装或解压后直接启动应用。

## 主要改进

- **优化的桌面 UI/UX**：改进界面的信息层次、窗口与侧栏交互、视觉样式和工作区组织，让会话、项目和文件信息更容易浏览。
- **增强的 Markdown 与过程展示**：针对 Markdown、工具调用和长会话优化阅读样式；提供独特的多步骤分组 UI、两种过程视图模式，以及更易定位上下文的改良会话导航条。
- **PI-TUI 主题兼容**：读取并适配 pi / PI-TUI 的主题 JSON 文件，可在应用中选择自定义主题并保留深浅色模式体验。
- **桌面工作区能力**：支持会话浏览与分支、Git worktree、项目文件预览、模型与技能配置，并与原生目录选择、窗口控制和系统托盘交互结合。

## 截图

主界面（左深色、右浅色）：

![主界面：会话、项目和文件浏览](./docs/screenshots/home.png)

对话界面（左深色、右浅色）：

![对话与多步骤过程分组](./docs/screenshots/chat.png)

按工具调用分组的多步骤展示：

![多步骤过程分组展示](./docs/screenshots/blocks.png)

文件差异预览：

![文件 diff 预览](./docs/screenshots/diff.png)

## 主题

Pi Web Desktop 兼容 pi 的主题 JSON 格式。主题字段、颜色变量与完整格式请参见 [pi 官方主题文档](https://pi.dev/docs/latest/themes)。

### 放置主题文件

将 `.json` 主题文件放到全局主题目录：`~/.pi/agent/themes/`

应用会优先使用所选项目可见的主题集合；在设置中选择主题后，可根据当前深浅色模式加载对应变体。

### 命名规则

主题按基础名称组织，使用 `-dark.json` 与 `-light.json` 后缀识别深色和浅色变体：

```text
gruvbox-dark.json
gruvbox-light.json
```

以上两个文件组成名称为 `gruvbox` 的主题组。建议总是为同一主题提供成对的深色与浅色文件，以便在深色、浅色与系统模式之间获得一致体验。单个 `主题名.json` 也可以使用，但缺少对应变体时，应用只能回退到该文件或另一侧变体。

仓库在 [`docs/themes/`](./docs/themes/) 附带以下可直接参考或复制的主题文件：

- `gruvbox-dark.json` / `gruvbox-light.json`
- `solarized-dark.json` / `solarized-light.json`

## 与上游 pi-web 的关系

本项目是上游 pi-web `v0.7.16` 的桌面化派生版本，而不是上游的镜像或官方替代品。我们会在适合本项目架构和桌面体验的前提下选择性吸收上游改进，但**不保证完全复现上游功能，也不保证与上游版本或功能更新完全同步**。

## 注意事项

- **数据目录**：默认读取 `~/.pi/agent/sessions` 下的会话文件。可通过环境变量 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **会话文件**：路径形如 `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置**：Models 面板读写 pi agent 目录下的 `models.json`，模型列表和默认模型由 pi 的配置解析得到。
- **文件访问**：文件浏览和预览面向当前选择的项目目录，以及会话中已出现过的工作目录。
- **Git worktree**：什么时候显示切换器、新建目录在哪里、删除会影响什么，见 [pi-web 里的 Worktree](./docs/worktrees.zh-CN.md)。
- **Fork 与会话内分支不同**：Fork 会创建新的 `.jsonl` 文件；“Edit from here” 是同一会话文件里的分支。
- **网络访问**：默认仅监听 `127.0.0.1`。如需绑定局域网地址，请设置 `PI_WEB_PASSWORD`，并配合 HTTPS 或可信 VPN；HTTP Basic Auth 不会加密凭据。

## 开发

```bash
npm install
npm run dev
```

本地开发端口为 [http://localhost:30141](http://localhost:30141)。

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm test
```

开发时不要运行 `next build` / `npm run build`，它会写入 `.next/`，容易影响正在运行的 dev server。发布流程再执行构建。



## 项目结构

```
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE 事件流
    auth/           # OAuth 和 API key 管理
    cwd/validate/   # 自定义工作目录校验
    default-cwd/    # 获取 pi 默认工作目录
    files/          # 文件列表、读取、预览、watch
    home/           # 当前用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    sessions/       # 会话读取、重命名、删除、上下文、HTML 导出
    skills/         # skills 列表、搜索、安装、启停
components/
  AppShell.tsx        # 主布局、URL 状态、顶部面板、文件标签
  SessionSidebar.tsx  # 项目选择、会话树、Explorer
  ChatWindow.tsx      # 消息区、SSE、拖拽图片、minimap
  ChatInput.tsx       # 输入栏、模型/工具/thinking/compact/slash controls
  MessageView.tsx     # 消息、thinking、tool call/result 渲染
  ModelsConfig.tsx    # 模型和认证配置面板
  SkillsConfig.tsx    # 技能管理面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码、diff、图片、音频、PDF、DOCX 预览
lib/
  rpc-manager.ts      # AgentSessionWrapper 生命周期和全局 registry
  session-reader.ts   # 解析 .jsonl 会话文件和分支上下文
  normalize.ts        # 规范化 toolCall 字段名
  file-access.ts      # 文件读取安全边界
  file-paths.ts       # 文件路径编码/相对路径工具
  markdown.ts         # Markdown/Mermaid/KaTeX 插件配置
  pi-types.ts         # pi 相关类型
hooks/
  useAgentSession.ts  # 会话加载、发送命令、SSE 状态机
  useAudio.ts         # 完成提示音
  useDragDrop.ts      # 图片拖拽
  useTheme.ts         # 主题切换
```
