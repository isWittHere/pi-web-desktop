# AGENTS.md - Project Guide for Coding Agents

## Project Overview

**pi-web** (`@agegr/pi-web`) is a web-based UI for the [pi coding agent](https://github.com/badlogic/pi-mono). It provides a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview — all powered by the pi SDK (`@earendil-works/pi-coding-agent`).

- **Purpose**: Give pi users a visual alternative to the CLI with session browsing, file exploration, and settings management.
- **Target Audience**: Developers using pi as their coding agent who want a richer UI.
- **Key Features**: Session browsing & forking, real-time SSE chat, file explorer & viewer, model/plugins/skills configuration, pi CLI theme system (load & preview JSON themes), Git worktree management, Electron desktop app support, i18n (English & 中文).

---

## Fork Strategy & Upstream Integration Policy

This project began from upstream pi-web `v0.7.16`, but is now a deliberately diverged **Electron-first desktop product**. Upstream pi-web remains an important source of Pi SDK compatibility, security, correctness, and reliability improvements; it is **not** the UI/UX baseline for this repository.

### Product Priority

1. **Preserve the desktop product experience.** Frameless Electron behavior, the custom title bar, Phosphor/provider icons, IA Writer Quattro/Lilex typography, advanced theme system, process-timeline message UI, right-side navigation, enhanced Markdown, and desktop sidebar interactions are protected product assets.
2. **Align upstream core behavior.** Prefer porting upstream fixes for security boundaries, Pi SDK/API compatibility, model/session/auth correctness, filesystem safety, and SSE reliability.
3. **Port behavior, not whole components.** When an upstream core change needs UI support, implement its observable behavior inside the local component architecture. Do not wholesale replace local `components/` files, `AppShell.tsx`, theme systems, or CSS with upstream Web-first implementations. The i18n registry/provider/catalog is an approved standalone architecture migration, but its desktop startup behavior and local message coverage must be preserved.
4. **Migrate coupled features as a unit.** Do not partially port cross-layer changes. For example, model scope support must cover SDK resolution, API response/cache contracts, `AgentSession` construction, and local UI feedback—not merely model-selector filtering.
5. **Keep each upstream port reversible.** Separate SDK/runtime, security, data integrity, auth, SSE, and UI changes into focused commits with focused tests and manual validation.

### Mandatory Merge Rules

- Treat `ref-repos/` as read-only comparison material. It is never staged, committed, copied wholesale, or used as a replacement source tree.
- Never overwrite local `package.json`: preserve Electron packaging/scripts, fonts, icons, and desktop release tooling while manually reconciling upstream runtime dependencies.
- Treat `components/AppShell.tsx`, `SessionSidebar.tsx`, `ChatWindow.tsx`, `ChatInput.tsx`, `MarkdownBody.tsx`, `FileViewer.tsx`, `app/globals.css`, and `hooks/useTheme.ts` as high-conflict desktop assets. Apply targeted behavioral changes only.
- i18n may align with upstream through a focused `lib/i18n` registry/provider/catalog migration. Do not replace local `AppShell` or settings UI to obtain it; preserve `app/layout.tsx` pre-hydration language bootstrap, existing `pi-language` migration, `data-language`, and all desktop-specific translations. The migration is complete: all call sites use `useI18n()`; no `useLanguage()` shim remains.
- Security updates must be adapted to the Electron server lifecycle. In particular, changing listener binding, Host/Origin validation, CORS, or `PI_WEB_PASSWORD` must be validated with `electron/main.js` readiness checks and BrowserWindow startup; never retain wildcard API CORS merely for LAN convenience.
- Upstream UI enhancements such as resizable panels may be adopted only by manually integrating their interaction/accessibility behavior with the local title bar, responsive layout, CSS variables, and i18n.

For the current upstream target and phased acceptance criteria, see `.myLastChat/MLC_上游v0.8.5合并规划与架构准则.md`.

---

## Technology Stack

| Category | Technology | Version |
|----------|-----------|---------|
| **Runtime** | Node.js / Next.js | Next 16.2.9 |
| **UI Library** | React | ^19.2.4 |
| **Language** | TypeScript | ^5 |
| **Styling** | Tailwind CSS | ^4.2.2 |
| **Markdown** | react-markdown + rehype/remark plugins | ^10.1.0 |
| **Math** | KaTeX (rehype-katex) | ^0.16.47 |
| **Diagrams** | Mermaid | ^11.14.0 |
| **Syntax Highlight** | react-syntax-highlighter | ^16.1.1 |
| **Document Preview** | mammoth (DOCX) | ^1.12.0 |
| **Icons** | Phosphor Icons, LobeHub icons | |
| **Fonts** | IA Writer Quattro, Lilex (mono) | |
| **Desktop** | Electron + electron-builder | ^43.1.1 / ^26.15.3 |
| **Linting** | ESLint (eslint-config-next) | ^9 |
| **SDK** | @earendil-works/pi-coding-agent | ^0.80.10 |
| **SDK** | @earendil-works/pi-ai | ^0.80.10 |
| **SDK** | @earendil-works/pi-tui | ^0.80.10 |
| **Package Manager** | npm (package-lock.json present) | |

---

## Project Structure

```
pi-web-main/
├── app/                          # Next.js App Router pages & API routes
│   ├── api/
│   │   ├── agent/                # AgentSession lifecycle, commands, SSE events
│   │   │   ├── new/route.ts      # POST { cwd, message, toolNames?, provider?, modelId? }
│   │   │   ├── [id]/route.ts     # GET state | POST any command (prompt, fork, compact, etc.)
│   │   │   ├── [id]/events/route.ts  # GET per-session SSE stream
│   │   │   └── running/events/route.ts # GET SSE of currently-running session ids
│   │   ├── auth/                 # OAuth & API key management
│   │   │   ├── all-providers/route.ts      # GET API-key provider list
│   │   │   ├── api-key/[provider]/route.ts # GET/POST/DELETE API key
│   │   │   ├── login/[provider]/route.ts   # GET OAuth/device-code SSE | POST manual code
│   │   │   ├── logout/[provider]/route.ts  # POST OAuth logout
│   │   │   └── providers/route.ts          # GET OAuth provider list
│   │   ├── cwd/validate/route.ts     # POST validate/select a working directory
│   │   ├── default-cwd/route.ts      # POST create ~/pi-cwd-YYYYMMDD
│   │   ├── file-index/route.ts       # GET file index for search
│   │   ├── files/[...path]/route.ts  # GET file contents (scoped allow-list)
│   │   ├── home/route.ts             # GET user home directory
│   │   ├── models/route.ts           # GET available models, default model, thinking levels
│   │   ├── models-config/route.ts    # GET/PUT read/write ~/.pi/agent/models.json
│   │   ├── models-config/test/route.ts # POST test a configured model/provider
│   │   ├── plugins/route.ts          # GET/POST package plugin management
│   │   ├── sessions/
│   │   │   ├── route.ts              # GET list all sessions (with project grouping)
│   │   │   ├── [id]/route.ts         # GET/PATCH/DELETE session
│   │   │   ├── [id]/context/route.ts # GET ?leafId= context for a specific branch leaf
│   │   │   └── [id]/export/route.ts  # GET exported HTML for a session
│   │   ├── skills/route.ts           # GET/PATCH loaded skills & disable-model-invocation
│   │   ├── skills/install/route.ts   # POST install via npx skills add
│   │   ├── skills/search/route.ts    # GET/POST skills.sh search
│   │   ├── themes/route.ts           # GET list available theme sets
│   │   ├── themes/[name]/route.ts    # GET resolve a specific theme variant
│   │   └── worktrees/route.ts        # GET/POST/DELETE git worktrees
│   ├── globals.css               # Global styles + CSS variables + Tailwind
│   ├── layout.tsx                # Root layout (fonts, theme, i18n init)
│   ├── page.tsx                  # Entry point → AppShell
│   ├── icon.ico / icon.png / icon.svg / favicon.svg  # App icons
│   └── pi-original.svg           # Pi branding
│
├── components/                   # React components
│   ├── AppShell.tsx              # Main layout: sidebar, chat, tabs, URL state
│   ├── AppTitleBar.tsx           # Custom Electron frameless title bar
│   ├── SessionSidebar.tsx        # Project selector, session tree, FileExplorer
│   ├── ChatWindow.tsx            # Messages, SSE streaming, image drag/drop, minimap
│   ├── ChatInput.tsx             # Input bar: model/tools/thinking/compact/slash controls
│   ├── MessageView.tsx           # Renders one message (user/assistant/toolCall/toolResult)
│   ├── BranchNavigator.tsx       # In-session branch switcher
│   ├── ChatMinimap.tsx           # Scroll minimap alongside the message list
│   ├── MarkdownBody.tsx          # Markdown renderer (with Mermaid, KaTeX, code blocks)
│   ├── CompactionSummary.tsx     # Compaction summary display
│   ├── DisplayConfig.tsx         # Display settings panel
│   ├── FileExplorer.tsx          # File tree inside sidebar
│   ├── FileIcons.tsx             # File icon helpers
│   ├── FileViewer.tsx            # Source, diff, image, audio, PDF, DOCX preview
│   ├── ModelsConfig.tsx          # Modal for editing models.json
│   ├── PluginsConfig.tsx         # Modal for installed package plugins
│   ├── SkillsConfig.tsx          # Modal for loaded/search/installable skills
│   ├── ProcessGroup.tsx          # Process/step visualization groups
│   ├── SessionInfoBar.tsx        # Context usage, cost, compaction state
│   ├── SettingsModal.tsx         # Generic settings modal container
│   ├── ChatConfig.tsx            # Chat settings panel (input shortcut, etc.)
│   ├── ProviderIcon.tsx          # Provider logo icon component (30+ providers)
│   ├── SettingToggle.tsx         # Reusable toggle switch + settings section layout
│   ├── TabBar.tsx                # Tab bar (Chat + open file tabs)
│   └── MarkdownBody.test.mjs     # Markdown rendering tests
│
├── hooks/                        # React hooks
│   ├── useAgentSession.ts        # Messages + streaming + SSE + fork/navigate/reconciliation
│   ├── useAudio.ts               # Completion sound + AudioContext unlock
│   ├── useDragDrop.ts            # Shared drag/drop state for images
│   ├── useElectronWindow.ts      # Electron window controls bridge
│   ├── useIsMobile.ts            # Responsive breakpoint hook
│   ├── useKeyboardShortcuts.ts   # Global keyboard shortcuts
│   ├── useI18n.tsx               # i18n provider/hook (en / zh-CN)
│   ├── useProcessDisplayMode.ts  # Process visualization preferences
│   └── useTheme.ts              # Dark/light theme
│
├── lib/                          # Shared utilities & SDK wrappers
│   ├── agent-client.ts           # Typed fetch helper for /api/agent commands
│   ├── allowed-roots.ts          # Additional allowed file roots
│   ├── ansi.ts                   # ANSI escape code parsing
│   ├── api-types.ts              # Shared API type definitions
│   ├── chat-lazy-load.ts         # Lazy loading helper for chat content
│   ├── clipboard.ts              # Clipboard operations
│   ├── compaction-summary.ts     # Compaction summary parsing
│   ├── draft-store.ts            # Local draft persistence helpers
│   ├── file-access.ts            # Allowed file roots for /api/files and worktrees
│   ├── file-dirent.ts            # Directory entry types
│   ├── file-fuzzy.ts             # Fuzzy file matching
│   ├── file-links.ts             # File link resolution
│   ├── file-paths.ts             # Client/server path encoding helpers
│   ├── file-types.ts             # File type detection
│   ├── file-upload.ts            # File upload handling
│   ├── markdown.ts               # Markdown/Mermaid/KaTeX plugin configuration
│   ├── message-display.ts        # Message display helpers
│   ├── models-cache.ts           # Models configuration cache
│   ├── normalize.ts              # normalizeToolCalls() — field name mismatch fix
│   ├── npx.ts                    # npx runner used by skill install
│   ├── patch.ts                  # Object patching utilities
│   ├── pi-types.ts               # Local structural types for pi SDK objects
│   ├── process-content.ts        # Process content categorization
│   ├── rpc-manager.ts            # AgentSessionWrapper + registry + startRpcSession
│   ├── session-file-references.ts        # Session file reference resolution
│   ├── session-file-references-core.ts   # Core session file reference logic
│   ├── session-reader.ts         # SessionManager wrappers + path cache + context adapter
│   ├── skill-lock.ts             # Skill locking utilities
│   ├── skill-updates.ts          # Skill update helpers
│   ├── skills-service.ts         # Skills service abstraction
│   ├── step-categorizer.ts       # Step categorization for process display
│   ├── step-visuals.ts           # Step visualization helpers
│   ├── theme.ts                  # Pi CLI theme loader, 256-color palette, CSS var mapper
│   ├── tool-presets.ts           # PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
│   ├── types.ts                  # Shared TypeScript types
│   └── worktree.ts               # Project/worktree resolution and git worktree ops
│
├── electron/                     # Electron desktop shell
│   ├── main.js                   # Electron main process (window, tray, server lifecycle)
│   ├── preload.js                # Context bridge for window controls & directory select
│   └── tray-icon.png             # System tray icon
│
├── bin/                          # CLI entry points
│   ├── pi-web.js                 # npm bin entry (starts Next.js server)
│   └── pi-web-options.js         # CLI option parsing
│
├── scripts/                      # Build & release scripts
│   └── build-release.mjs         # Automated release build script
│
├── docs/                         # Documentation
│   ├── screenshot2.png           # Screenshot
│   ├── release.md                # Release process docs
│   ├── worktrees.md              # Worktrees user documentation (EN)
│   └── worktrees.zh-CN.md        # Worktrees user documentation (中文)
│
├── public/                       # Static assets
│   ├── catppuccin-icons/         # File icon theme
│   ├── favicon.svg / icon.*      # App icons
│   ├── gruvbox-dark.json         # Built-in pi CLI theme (Gruvbox Dark)
│   └── pi-original.svg           # Pi logo
│
├── main.js                       # ⚠️ Legacy electron entry (superseded by electron/main.js)
├── global.d.ts                   # Ambient type declarations for Electron bridge
├── next.config.ts                # Next.js config (CORS, externals, env vars)
├── tailwind.config.ts            # Tailwind CSS configuration
├── postcss.config.mjs            # PostCSS config (Tailwind plugin)
├── tsconfig.json                 # TypeScript config (strict, bundler resolution)
├── eslint.config.mjs             # ESLint config (Next.js core-web-vitals + typescript)
├── package.json                  # Dependencies, scripts, electron-builder config
├── bun.lock                      # Bun lockfile (historical)
└── package-lock.json             # npm lockfile
```

---

## Development Standards

### Code Style
- **TypeScript**: Strict mode enabled (`"strict": true`)
- **Module resolution**: Bundler mode with `@/*` path alias mapping to project root
- **JSX**: `react-jsx` transform (no need for explicit `import React`)
- **Target**: ES2017
- **Linting**: ESLint with `eslint-config-next` (core-web-vitals + typescript rules)
- **Custom ESLint overrides**:
  - `react-hooks/immutability`: off
  - `react-hooks/refs`: off
  - `react-hooks/set-state-in-effect`: off
- **Ignored directories**: `ref-repos/` (reference repos, never committed)

### File Organization
- **API routes**: Next.js App Router route handlers in `app/api/`, one `route.ts` per endpoint
- **Components**: One component per file in `components/`, PascalCase filenames
- **Hooks**: One hook per file in `hooks/`, `use` prefix camelCase
- **Lib**: Utility modules in `lib/`, kebab-case filenames
- **Tests**: `*.test.mjs` files co-located with the module they test (in `components/` and `lib/`)
- **Client/server separation**: `lib/` files may run on either side; `components/` and `hooks/` are client-only

### Import Patterns
- Path alias `@/` for project root imports (e.g., `import { AppShell } from "@/components/AppShell"`)
- External packages imported by name
- pi SDK packages must be listed in `serverExternalPackages` in `next.config.ts`

### Error Handling
- pi SDK errors propagate through `AgentSessionWrapper` and surface as SSE events
- API routes return standard HTTP status codes with JSON error bodies
- Electron startup errors shown via `dialog.showErrorBox()`

### Testing
- Tests use plain `.mjs` files (not TypeScript)
- Co-located with source files
- Focus on pure logic in `lib/` (rpc-manager, session-reader, normalize, etc.)
- Run with node directly or via similar test runner

### Documentation
- Code comments explain *why*, not *what*
- README.md for user-facing docs
- AGENTS.md for coding agent context
- `docs/` for detailed topic docs (worktrees, release)

---

## Key Files & Configurations

| File | Purpose |
|------|---------|
| `next.config.ts` | Next.js config: server external packages (pi SDK), CORS headers, version env vars |
| `tsconfig.json` | TypeScript: strict mode, bundler resolution, `@/*` paths, ES2017 target |
| `tailwind.config.ts` | Tailwind: scans `pages/`, `components/`, `app/` |
| `postcss.config.mjs` | PostCSS: `@tailwindcss/postcss` plugin |
| `eslint.config.mjs` | ESLint: Next.js configs + custom rule overrides |
| `package.json` | Dependencies, scripts, electron-builder packaging config |
| `electron/main.js` | Electron main process: frameless window, tray, server lifecycle |
| `electron/preload.js` | Context bridge: window controls IPC, directory picker |
| `global.d.ts` | Ambient types for `window.electron` and `window.piDesktop` |
| `bin/pi-web.js` | CLI entry point (`npx @agegr/pi-web`) |
| `app/layout.tsx` | Root layout: fonts, theme mode/name migration & init, i18n init (inline script before hydration) |
| `app/page.tsx` | Entry: renders `<AppShell />` inside `<Suspense>` |
| `app/globals.css` | Global styles + CSS variables (see below) |

### CSS Variables (`app/globals.css`)
Tailwind v4 `@theme` maps CSS custom properties to utility classes. Core variables:
```
--bg --bg-panel --bg-secondary --bg-card --bg-hover --bg-selected --bg-card-hover --bg-subtle
--border --border-hover
--text --text-muted --text-dim
--accent --accent-hover --accent-blue
--accent-red --accent-green --accent-orange
--user-bg --assistant-bg --tool-bg
--hatch-color --font-mono
```
Dark/light `:root` / `html.dark` defaults are defined in `globals.css` but overridden at runtime by the theme system (see Theme System below).

---

## Development Workflow

### Setup
```bash
npm install
```

### Development Server
```bash
npm run dev   # Starts Next.js dev server on port 30141 with Turbopack
```
Then open [http://localhost:30141](http://localhost:30141).

### Type Checking
```bash
node_modules/.bin/tsc --noEmit
```

### Linting
```bash
npm run lint
```

### ⚠️ Never run `next build` during development
It pollutes `.next/` and breaks `npm run dev`. Only use `npm run build` for release work.

### Production Build
```bash
npm run build     # Next.js production build
npm run start     # Start production server on port 30141
npm run release   # Bump version, build, publish to npm
```

### Electron Desktop App
```bash
npm run electron:dev       # Run Electron in development
npm run electron:build     # Build + package for current platform
npm run electron:dir       # Build + package (unpacked dir, Windows)
npm run electron:portable  # Build + package (portable exe, Windows)
```

### Release Build
```bash
node scripts/build-release.mjs   # Git backup + full release build
```

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running/events ───▶ running id SSE     │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

- **Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.
- **Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

### Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## Common Tasks

### Adding a new API route
1. Create `app/api/<endpoint>/route.ts`
2. Export named functions: `GET`, `POST`, `PATCH`, `DELETE`
3. Use `NextRequest` / `NextResponse` from `next/server`
4. If interacting with pi SDK, wrap in `startRpcSession()` / session methods

### Adding a new component
1. Create `components/ComponentName.tsx`
2. Use `"use client"` directive if it uses hooks or browser APIs
3. Import with `@/components/ComponentName`
4. Co-locate tests as `ComponentName.test.mjs` if needed

### Adding a new dependency
```bash
npm install <package>
```
If it's a server-side package that shouldn't be bundled by Next.js, add it to `serverExternalPackages` in `next.config.ts`.

### Renaming/deleting sessions
- `PATCH /api/sessions/[id]` with `{ name }` to rename
- `DELETE /api/sessions/[id]` to delete (cascade-reparents children)

### Creating a new agent session
```typescript
POST /api/agent/new
Body: { cwd: string, message: string, toolNames?: string[], provider?: string, modelId?: string }
```

---

## Important Notes

### AgentSession Lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- **Idle timeout**: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork Must Destroy the Wrapper Immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two Kinds of Branching — Don't Confuse Them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session Files Can Be Fully Rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall Field Normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New Session Tool Preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

### Model Defaults for New Sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions.

### SSE Reconnect on Page Refresh Mid-Stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE Events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Running State SSE + Reconciliation
- The sidebar listens to `/api/agent/running/events`, backed by `subscribeRunningSessions()` in `lib/rpc-manager.ts`, so running badges update without polling.
- `useAgentSession` still treats per-session SSE as primary for chat events, but while a run is active it periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed `agent_end` events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Worktrees and Project Grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### File Access Allow-List
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.

### Plugins and Skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Auth and Model Config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must **never** return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is **not** a real route.

### Completion Sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported Session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

### Electron Desktop Specifics
- **Frameless window**: Custom title bar via `AppTitleBar.tsx` + `useElectronWindow.ts`; layout changes must preserve the title bar drag region, native window controls, and workspace-control hosts.
- **System tray**: Minimize to tray on close; double-click tray to restore; Quit from tray menu
- **Server lifecycle**: Electron waits for an existing server on port 30141, starts one if not found. Changes to listener binding, password authentication, Host/Origin checks, or response status handling must keep this readiness path working.
- **Default network boundary**: The desktop server should remain loopback-only unless an explicit, security-reviewed LAN mode is enabled. Do not use wildcard API CORS as a substitute for an access-control design.
- **Dev vs Production**: `IS_DEV` determined by checking `resources/app` and `resources/app.asar` existence (since `asar: false`, `app.isPackaged` returns false even in production)
- **Process spawning**: Uses `fork()` (not `spawn()`) in production because `process.execPath` is `Pi Web.exe`, not Node.js

### Theme System (`lib/theme.ts` + `hooks/useTheme.ts` + `app/api/themes/`)
- **Theme sets**: Themes are organized as paired dark+light variants under a base name (e.g. "gruvbox" → `gruvbox-dark.json` + `gruvbox-light.json`). Single-file themes are also supported.
- **File lookup** (global → project): `~/.pi/agent/themes/` then `<cwd>/.pi/themes/`. Also accepts direct file paths.
- **Resolution**: `lib/theme.ts` parses pi CLI theme JSON, resolves `vars` references, converts 256-color indices to hex via xterm palette, and maps 51 pi CLI tokens to ~23 pi-web CSS custom properties.
- **API**: `GET /api/themes` lists available theme sets; `GET /api/themes/{name}?mode=dark|light` resolves a specific variant and returns the CSS variable map.
- **Cache**: `useTheme` caches resolved themes by `name::mode` in a module-level Map.
- **Border depth slider**: User-adjustable 0-100 range blends `--border`/`--border-hover` from invisible (matches bg) → theme default → max contrast (matches text). Uses `color-mix()`.
- **View transitions**: `toggleTheme()` uses the View Transition API with a circular clip-path animation triggered from the click origin.
- **System color scheme**: `useTheme` subscribes to `(prefers-color-scheme: dark)` media query for "system" mode.
- **Layout inline script**: `app/layout.tsx` reads `pi-theme-mode`, `pi-theme`, runs migration from old per-mode keys (`pi-theme-dark`/`pi-theme-light`), and sets `data-theme-mode`/`data-theme-resolved-mode`/`dark` class before React hydration. The per-mode-key migration is self-cleaning and idempotent; it may be dropped once no supported release writes the old keys.
- **Built-in defaults**: `globals.css` provides `:root` (light) and `html.dark` (dark) CSS variable defaults. They act as fallback when no pi CLI theme is selected.

### i18n
- Supports English (`en`) and 中文 (`zh-CN`).
- Current language is bootstrapped before hydration by `app/layout.tsx`, which reads `pi-language`, applies `html.lang` and `data-language`, and prevents a visible language flash in Electron.
- The target architecture is upstream-aligned `lib/i18n/` primitives (locale registry, provider, message catalogs, interpolation, locale-aware formatting) with local desktop adaptations.
- i18n migration is complete: all call sites use `useI18n()`; the `useLanguage()` shim was removed. The `pi-language` → `pi-locale` localStorage migration in `app/layout.tsx` is a self-cleaning, idempotent upgrade path for pre-migration users; it may be dropped once no supported release writes the old key.
- Any catalog change needs English/Chinese key-parity and call-site-resolution tests; do not import upstream AppShell or language-menu UI merely to adopt i18n.

### ref-repos
- `ref-repos/` directory contains reference source code for development
- It is comparison-only: inspect and selectively reimplement required behavior in the local architecture; never use it for a wholesale source-tree or component replacement.
- **Never commit** to git; explicitly inspect `git status` before staging upstream-integration work.
- Excluded from TypeScript compilation in `tsconfig.json`
- Excluded from ESLint in `eslint.config.mjs`

---

*Last Updated: 2026-07-31*
*Generated by: AGENTS-maker*
