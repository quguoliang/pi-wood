# 以 Pi 为核心的桌面端 Agent 工作台 · 产品与技术方案（组件级 v2.0）

> 工作名称（可随时替换）：**PiDesk / Pi Workbench / PiHub**
> 版本：v2.2（API 修订） · 日期：2026-08-30 · 状态：方案评审稿
> 一句话：**一个本地优先的桌面 Agent 工作台，把 Pi Coding Agent 作为唯一内核嵌入进程内，用 Codex 式三栏交互承载完整开发闭环，并 100% 复用 Pi 官方生态（扩展 / Skills / 提示词模板 / 主题 / 包 / Provider / 会话树）。**
> 本版相对 v1.0 的增量：**每个 UI 区域给出具体组件树与组件选型；每层给出精确依赖清单；IPC 通道、TS 类型、主题 token 映射、插件 manifest 全部给到可编码级别。**
> v2.1 组件刷新：**工作台改用 dockview、文件树换 headless-tree、代码编辑换 CodeMirror 6（`@codemirror/merge` 做 diff）、Markdown 换 streamdown + Shiki、IPC 采用 electron-trpc。**
> v2.2 API 修订（2026-08-30 对照官方文档核实，见执行计划 §1）：① `createAgentSession` 选项为 `modelRuntime`（无 `modelRegistry`/`authStorage` 参数）；② `newSession/switchSession/fork` 位于 `AgentSessionRuntime`；③ EngineEvent 补 `auto_retry_*`/`summarization_retry_*`；④ 思考档位运行时动态获取。

---

## 0. 一页摘要

| 维度 | 结论 |
|---|---|
| 内核 | **Pi Coding Agent**（`@earendil-works/pi-coding-agent`，MIT，pi.dev） |
| 接入方式 | **SDK 进程内嵌入**为主（`createAgentSession()`，与 OpenClaw 同路线），**RPC 子进程**为备 |
| 桌面框架 | **Electron + React 18 + TypeScript + Vite**（Pi SDK 是 Node/TS，同构最顺） |
| UI 底座 | Tailwind CSS v4 + CSS 变量主题 + `dockview`（工作台停靠布局）+ `@tanstack/react-virtual`（虚拟列表）+ Zustand（状态） |
| 布局 | 三栏：左=项目/会话树，中=对话流，右=多功能工作台（浏览器/终端/文件/代码/diff，可扩展 tab） |
| 生态 | 扩展、Skills、Prompt Templates、Themes、Pi Packages（npm/git）、15+ Provider、自定义模型源、会话树全部原生接入 |
| 差异化 | 内核即官方 Pi（非自研 agent）；插件写一次，CLI 与桌面通用；面板能力即 agent 工具 |
| 工期 | 单人 4~6 周 MVP（Phase 0~2），12~16 周全量 |

---

## 1. 背景与定位

### 1.1 为什么是 Pi

Pi（pi.dev / `earendil-works/pi`）是"极简 Agent 框架（minimal agent harness）"：内核只提供读/写/改文件、执行命令等极少量基础工具，其余一切（子代理、计划模式、权限门、MCP、状态栏……）都通过 **TypeScript 扩展 / Skills / 提示词模板 / 主题 / Pi 包** 由用户自己组装。这一哲学与"可二次开发、可插拔的桌面工作台"天然契合：

- **内核极简、可全权控制**：不对抗封闭产品，而是把它当引擎库嵌入自己的 UI。
- **官方提供四种运行形态**：交互式 TUI、Print/JSON、RPC（stdin/stdout JSONL）、**SDK（进程内嵌入）**。桌面端正是 SDK / RPC 的目标场景。
- **生态成熟**：15+ 大模型源、pi.dev 包市场（npm/git 安装）、大量社区扩展（LazyPi 等集合包）、会话树与分支共享。
- **MIT 协议**：可商用、可改、可分发。
- **有先例**：OpenClaw 已通过 `createAgentSession()` 把 Pi 嵌入其消息网关，证明进程内嵌入完全可行。

### 1.2 产品定位

> 把"终端里好用的 Pi"升级成"桌面级 IDE 式工作台"，但**不改变 Pi 的世界观**——内核仍是 Pi，生态仍是 Pi 生态，桌面只负责：更丰富的 UI、更强大的"环境面板"（浏览器/终端/文件/diff）、更顺滑的审批流。

- **内核 = 官方 Pi**：不 fork、不自研 Agent。升级 Pi 版本即可获得官方能力。
- **交互 = Codex 式**：三栏布局、流式对话、工具卡片、命令面板、键盘优先。
- **环境 = 工作台（Workbench）**：右侧面板让"浏览器、终端、文件、代码、diff"成为 agent 的"眼睛和手"，同时也成为用户的观察与干预界面。
- **生态 = 无缝**：任何 Pi 扩展、Skill、主题、包，装上就能在桌面里跑；桌面新增能力以"桌面扩展 API"补充，不破坏兼容性。

### 1.3 竞品与差异化

| 产品 | 内核 | 形态 | 差异点 |
|---|---|---|---|
| **本方案（PiDesk）** | 官方 Pi SDK | 三栏桌面工作台 | 内核即官方 Pi；工作台面板与 Pi 工具系统打通；插件 CLI/桌面通用 |
| Codex（OpenAI 桌面） | 闭源 | 三栏桌面 | 锁定 OpenAI 模型；无扩展生态 |
| Claude Code / Codex CLI | 闭源 | 终端 | 无 GUI 工作台 |
| Cursor / Windsurf | 自研 | IDE | 编辑器为中心，非可嵌入的 agent 引擎 |
| PI-Desktop（LGPL） | 自研（Rust+Electron） | 三栏桌面 | 自研 agent + 自研 .piplug 体系，**非官方 Pi 内核** |
| Pi Agent Desktop | 官方 Pi | 桌面工作台 | 轻量包装 CLI + 会话管理；缺少"面板即 agent 工具"与 IDE 级三栏 |

> 结论：**"官方 Pi 内核 + IDE 级三栏工作台 + 面板工具即 agent 工具"这一组合仍是空白**，即差异化空间。

### 1.4 目标用户

- 已用 / 想用 Pi CLI 的开发者，希望有 GUI 但不想换内核。
- 习惯 Codex / Cursor 三栏交互、但想要"自带 Key、多模型、可深度定制"的开发者。
- 前端工程师（本方案典型构建者）：Electron + React 全栈顺手。

---

## 2. 总体架构与依赖清单

### 2.1 引擎接入：SDK 内嵌为主，RPC 为备

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A. SDK 进程内嵌入（主）** | 主进程 `createAgentSession({ cwd, model, modelRuntime, sessionManager, resourceLoader, customTools })`，`session.subscribe()` 收事件，`session.prompt()/steer()/followUp()` 发指令；会话级操作经 `createAgentSessionRuntime()` 返回的 `AgentSessionRuntime` | 与 OpenClaw 同路线；可注入自定义工具；事件进程内直达；可精确控制会话生命周期 | 与 Pi 版本耦合，升级需回归 | **主路径** |
| **B. RPC 子进程（备）** | 拉起 `pi --mode rpc`，JSONL over stdin/stdout；命令 `prompt/steer/follow_up/bash/set_model/get_state/get_session_stats...` | 与版本解耦；协议有文档；可用用户自装 pi | 多一层序列化；自定义工具需经扩展注入 | **备路径/兼容层** |

**决策（v2.2 修订）：做 `EngineAdapter` 接口 + 双实现，但 MVP 仅实现 A（SDK）。** B（RPC）保留接口占位，推迟到出现"用户用本机 pi 可执行文件"的真实需求再实现——SDK 异常多为 Pi 版本变动，RPC 同样会受影响，双实现维护成本大于收益。

```ts
// packages/engine/src/adapter.ts —— 引擎适配层接口（渲染层只依赖这一层）
// 注意：newSession/switchSession/fork 三个方法由 createAgentSessionRuntime() 返回的
// AgentSessionRuntime 提供（不在 AgentSession 上）；sdk-adapter 需持有 runtime 实例。
export interface EngineAdapter {
  start(opts: EngineStartOptions): Promise<void>;
  stop(): Promise<void>;
  subscribe(fn: (e: EngineEvent) => void): () => void;   // 主进程内事件订阅
  prompt(text: string, opts?: PromptOpts): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  compact(custom?: string): Promise<CompactionResult>;
  newSession(opts?: { parentSession?: string }): Promise<void>;
  switchSession(file: string): Promise<void>;
  fork(entryId: string, pos: "before" | "at"): Promise<void>;
  navigateTree(targetId: string, opts?: { summarize?: boolean; label?: string }): Promise<{ editorText?: string; cancelled: boolean }>;
  getState(): Promise<SessionState>;
  getSessionStats(): Promise<SessionStats>;
}
```

### 2.2 分层架构

```
┌────────────────────────────────────────────────────────────────────┐
│  Renderer（React，三栏）                                             │
│  ┌─────────────┬──────────────────────────┬──────────────────────┐  │
│  │ Left Panel  │ Center Panel             │ Right Panel          │  │
│  │ 项目 · 会话  │ 对话流 · 工具卡片 · 审批    │ 浏览器│终端│文件│代码│diff│  │
│  │ 树 · 分支    │ 输入 · 模型切换 · 状态栏    │  + 插件自定义 Tab     │  │
│  └─────────────┴──────────────────────────┴──────────────────────┘  │
│  ▲  typed IPC（contextBridge + electron-trpc/zod）▼                 │
├────────────────────────────────────────────────────────────────────┤
│  Electron Main（Node）                                               │
│  ├─ EngineAdapter(SDK) ── createAgentSession()                      │
│  │     ├─ EventBridge → renderer（engine:event）                    │
│  │     ├─ CommandBus ← renderer（engine:command）                   │
│  │     └─ CustomToolHost：browser/terminal/file/diff 工具            │
│  ├─ EngineAdapter(RPC) ── pi --mode rpc 子进程（可选）                │
│  ├─ ProjectManager：项目注册/信任/watch、AGENTS.md、.pi 发现          │
│  ├─ ResourceManager：extensions/skills/prompts/themes/packages       │
│  ├─ ProviderManager：ModelRegistry + AuthStorage（密钥→系统钥匙串）   │
│  ├─ WorkbenchHost：WebContentsView / pty / 快照服务                  │
│  └─ PluginHost：utilityProcess 沙箱 + 桌面扩展 API                    │
└────────────────────────────────────────────────────────────────────┘
```

### 2.3 进程模型

```
┌──────────────┐     ┌──────────────┐     ┌───────────────────┐
│ Renderer     │     │ Main (Node)  │     │ utilityProcess #N │
│ (三栏 UI)    │◄───►│ · Engine     │◄──► │ 插件沙箱           │
│ (可多窗口)    │ IPC │ · Workbench  │     │ 只通过 API 通信     │
└──────────────┘     │ · PluginHost │     └───────────────────┘
                     └──────┬───────┘
                            │ child_process
                     ┌──────▼───────┐     ┌──────────────┐
                     │ node-pty     │     │ WebContents  │
                     │ (终端 shell) │     │ View(浏览器)  │
                     └──────────────┘     └──────────────┘
```

- **Main** 持有唯一 `AgentSession`（当前项目），是 agent 状态唯一权威来源。
- **插件**跑在独立 `utilityProcess`，仅暴露白名单 API，崩溃不影响主进程。
- **终端/浏览器**是独立原生资源，由 Main 管理生命周期，渲染层只持句柄（id）。

### 2.4 完整依赖清单（可编码级）

#### 运行时核心

| 包 | 作用 | 备注 |
|---|---|---|
| `@earendil-works/pi-coding-agent` | Pi 内核 SDK（AgentSession/ResourceLoader/ModelRegistry/AuthStorage/SessionManager/SettingsManager） | 版本 Pin，走 EngineAdapter |
| `@earendil-works/pi-agent-core` | Agent/AgentState 等底层类型 | SDK 间接依赖 |
| `@earendil-works/pi-ai` | `getModel`、`StringEnum`、Model 类型 | |
| `@earendil-works/pi-tui` | 仅用于扩展侧 `ctx.ui` 桥接的类型引用 | 渲染层不直接用 |
| `electron` | 桌面壳 | ≥30（用 `WebContentsView`） |
| `node-pty` | 终端 PTY（主进程） | 需按 Electron ABI 重编译；Windows 备选 `@homebridge/node-pty-prebuilt-multiarch` |
| `playwright-core` 或 `chrome-remote-interface` | 浏览器 agent 工具（CDP） | 见 §10.1 |
| `better-sqlite3`（可选） | 会话/文件搜索索引 | |

#### 渲染层 UI 组件（逐库）

| 用途 | 包 | 组件 | 说明 |
|---|---|---|---|
| 工作台停靠布局 | `dockview` | `<Dockview>` / `<Gridview>` | 内建 tab 条、分组、拖拽停靠、浮动面板、popout 窗口、布局序列化；右栏工作台（浏览器/终端/文件/代码/diff）用它组织 |
| 顶层三栏分割 | `react-resizable-panels` | `PanelGroup/Panel/PanelHandle` | 仅用于左/中/右三栏的轻量分割；也可整体替换为 dockview Gridview |
| 虚拟滚动 | `@tanstack/react-virtual` | `useVirtualizer` | 消息列表、会话列表、文件列表通用 |
| Markdown 渲染 | `streamdown`（备选 `llm-message-react`）+ `remark-gfm` | `<MarkdownBody>` | AI 流式专用、drop-in react-markdown；代码高亮用 **Shiki**（`@shikijs/rehype` / `rehype-pretty-code`） |
| 代码编辑/预览 | `@codemirror/*` + `@uiw/react-codemirror` | `<CMEditor>` | CM6 轻量（~120-300KB）、CSS 变量主题贴合 Pi token；只读预览默认，右键切编辑 |
| 代码 Diff | `@codemirror/merge` | `<CMDiffView>` | 官方 merge view，主题随 CSS 变量 |
| 终端 | `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links` + `@xterm/addon-search` | `<TerminalView>` | 通过 IPC 接主进程 pty |
| 文件树 | `headless-tree` | `<FileTree>` | react-complex-tree 官方继任者；headless 样式全控、内建拖拽/键盘/搜索/重命名 |
| 命令面板/菜单 | `cmdk` + `@radix-ui/react-dropdown-menu` + `@radix-ui/react-context-menu` | `<CommandPalette>` `<SlashMenu>` | 备选 `modern-cmdk`（React 19 + 模糊评分 + frecency） |
| 弹层/确认 | `@radix-ui/react-dialog` + `@radix-ui/react-alert-dialog` + `@radix-ui/react-popover` + `@radix-ui/react-tooltip` | `<SettingsModal>` `<ConfirmDialog>` | 审批卡片走自定义内联组件 |
| 通知 | `sonner` | `<Toaster>` | 轻量、主题可配 |
| 表单 | `react-hook-form` + `zod` + `@hookform/resolvers` | `<ProviderForm>` | 表单逻辑复杂化后再考虑 `@tanstack/react-form` |
| 拖拽排序 | `@dnd-kit/core` + `@dnd-kit/sortable` | 项目排序、会话排序 | 工作台 tab 停靠/拖拽由 dockview 内建提供 |
| 图标 | `lucide-react` | `<Icon>` | 树摇友好 |
| 样式 | `tailwindcss@4` + `clsx` + `tailwind-merge` + `class-variance-authority` | `cn()` 工具 | CSS 变量承载 Pi 主题 token |
| 状态 | `zustand` | 6 个 store | §8 |
| IPC 类型 | `electron-trpc`（备选自研 zod + contextBridge） | 类型化 router | zod 仍在 IPC 边界做运行时校验；减少样板 |
| 键盘 | 自研 `useHotkeys`（`tinykeys` 亦可） | | |

> 设计原则：**重型组件（CodeMirror / xterm / dockview）按需懒加载**（`React.lazy` + 面板激活才挂载），首屏只加载 `ui-kit` 轻组件。

### 2.5 Monorepo 目录结构（文件级）

```
pi-desktop/
├─ apps/desktop/
│  ├─ electron/main/                       # 主进程
│  │  ├─ index.ts                          # app 启动、单实例、窗口创建
│  │  ├─ windows/main-window.ts            # 三栏窗口 + WebContentsView 挂载
│  │  ├─ ipc/                              # 所有 ipcMain.handle 注册（按域分文件）
│  │  │  ├─ engine.ipc.ts  project.ipc.ts  workbench.ipc.ts
│  │  │  ├─ plugin.ipc.ts  settings.ipc.ts auth.ipc.ts
│  │  ├─ engine/
│  │  │  ├─ engine-manager.ts              # EngineAdapter 装配/切换
│  │  │  ├─ sdk-adapter.ts  rpc-adapter.ts
│  │  │  ├─ event-bridge.ts                # AgentSessionEvent → EngineEvent
│  │  │  └─ custom-tools/                  # browser/terminal/file/diff 工具
│  │  ├─ workbench/
│  │  │  ├─ terminal-service.ts            # node-pty 池
│  │  │  ├─ browser-service.ts             # WebContentsView + CDP
│  │  │  ├─ snapshot-service.ts            # 编辑前后快照 → diff/回滚
│  │  │  └─ file-service.ts                # fs 封装（gitignore 感知）
│  │  ├─ project/project-manager.ts  trust-store.ts
│  │  ├─ provider/provider-manager.ts  keychain.ts
│  │  ├─ plugin/plugin-host.ts  plugin-registry.ts
│  │  └─ resources/resource-manager.ts     # 封装 DefaultResourceLoader
│  ├─ electron/preload/
│  │  ├─ index.ts                          # contextBridge.exposeInMainWorld('pi', api)
│  │  └─ api.ts                            # 由 zod schema 生成的类型化 API 面
│  └─ src/renderer/
│     ├─ main.tsx  App.tsx  styles/
│     ├─ components/
│     │  ├─ layout/   (AppShell/Panels/StatusBar)
│     │  ├─ left/     (ProjectPane/SessionPane/HistoryPane)
│     │  ├─ center/   (MessageList/…/Composer/ApprovalCard)
│     │  ├─ right/    (Dockview/BrowserView/TerminalView/…)
│     │  ├─ ui/       (Button/Dialog/Menu/Toaster/Markdown/…)
│     │  └─ panels/   (插件面板容器)
│     ├─ stores/      (session/project/workbench/model/settings/plugin)
│     └─ lib/         (ipc client、normalize、hotkeys、theme)
├─ packages/
│  ├─ engine/         # EngineAdapter 接口 + 双实现 + 事件/命令类型
│  ├─ ipc-schema/     # zod schema：全部通道契约（主/渲染共用）
│  ├─ workbench/      # 面板领域：terminal/file/editor/diff/browser 协议
│  ├─ agent-tools/    # browser/terminal 等 registerTool 实现（发布为 Pi 包）
│  ├─ plugin-api/     # 桌面扩展 API 类型 + 运行时桥
│  └─ ui-kit/         # 三栏组件库 + cn() + 主题变量
├─ extensions/        # 本项目自带 Pi 扩展：permission-gate / plan-mode / path-guard
└─ docs/              # 本方案 + 适配记录
```

---

## 3. IPC 契约（全通道定义）

> 通道契约以 `packages/ipc-schema` 的 zod schema 为唯一事实源；实现层用 **`electron-trpc`**（或自研 `contextBridge` + `ipcMain.handle`）生成类型化 API，preload 暴露 `window.pi.<domain>.<method>()`。**事件通道统一 `main→renderer` 用 `*:event`，请求通道统一 `renderer→main` 用 `invoke`（handle）**；zod 在 IPC 边界做运行时校验。

### 3.1 引擎域

| 通道 | 方向 | 载荷（zod 概要） |
|---|---|---|
| `engine:event` | M→R | `EngineEvent`（见下）—— 用 `webContents.send` 推送 |
| `engine:prompt` | R→M | `{ text, images?, streamingBehavior? }` |
| `engine:steer` | R→M | `{ text, images? }` |
| `engine:followUp` | R→M | `{ text, images? }` |
| `engine:abort` | R→M | `void` |
| `engine:setModel` | R→M | `{ provider, modelId }` |
| `engine:setThinking` | R→M | `{ level }` |
| `engine:compact` | R→M | `{ customInstructions? }` |
| `engine:newSession` | R→M | `{ parentSession? }` |
| `engine:switchSession` | R→M | `{ sessionFile }` |
| `engine:fork` | R→M | `{ entryId, position }` |
| `engine:navigateTree` | R→M | `{ targetId, opts? }` |
| `engine:getState` / `engine:getSessionStats` | R→M | `void → SessionState / SessionStats` |
| `engine:exportHtml` | R→M | `{ file? } → path` |

```ts
// packages/ipc-schema/src/engine.ts（示例）
export const EngineEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_update"), assistantMessageEvent: AssistantMessageEventSchema }),
  z.object({ type: z.literal("message_start"), message: AgentMessageSchema }),
  z.object({ type: z.literal("message_end"), message: AgentMessageSchema }),
  z.object({ type: z.literal("tool_execution_start"), toolCallId: z.string(), toolName: z.string(), input: z.unknown() }),
  z.object({ type: z.literal("tool_execution_update"), toolCallId: z.string(), output: z.string() }),
  z.object({ type: z.literal("tool_execution_end"), toolCallId: z.string(), isError: z.boolean(), result: z.unknown() }),
  z.object({ type: z.literal("bash_execution_update"), id: z.string(), output: z.string(), exitCode: z.number().nullable() }),
  z.object({ type: z.literal("agent_start") }), z.object({ type: z.literal("agent_end") }),
  z.object({ type: z.literal("turn_start") }), z.object({ type: z.literal("turn_end") }),
  z.object({ type: z.literal("queue_update"), steering: z.array(z.string()), followUp: z.array(z.string()) }),
  z.object({ type: z.literal("compaction_start") }), z.object({ type: z.literal("compaction_end"), summary: z.string() }),
  // v2.2 补全：自动重试 / 摘要重试事件（官方 SDK 文档确认存在）
  z.object({ type: z.literal("auto_retry_start") }), z.object({ type: z.literal("auto_retry_end") }),
  z.object({ type: z.literal("summarization_retry_scheduled") }),
  z.object({ type: z.literal("summarization_retry_attempt_start") }),
  z.object({ type: z.literal("summarization_retry_finished") }),
  // 注意：bash_execution_update 的输出在下一次 prompt 时才转成 UserMessage 进入上下文，
  // 工具卡片展示实时输出即可，不要假设其已写入会话记录。
  z.object({ type: z.literal("model_select"), model: ModelSchema }),
  z.object({ type: z.literal("approval_request"), request: ApprovalRequestSchema }),  // 自定义：权限门
  z.object({ type: z.literal("permission_granted"), requestId: z.string(), decision: z.string() }),
]);
```

### 3.2 项目/工作台/插件/设置域

| 域 | 通道（R→M handle） |
|---|---|
| 项目 | `project:list/add/remove/rename/open`、`project:trust(decide)`、`project:onChanged(事件)` |
| 文件 | `fs:tree(list)`、`fs:read`、`fs:write`、`fs:rename`、`fs:delete`、`fs:search`、`fs:gitStatus` |
| 终端 | `term:create/size/write/kill`、`term:onData(事件)`、`term:onExit(事件)` |
| 浏览器 | `browser:create/navigate/back/forward/reload/close`、`browser:cdp(domain,method,params)`、`browser:onState(事件)` |
| 代码/Diff | `diff:list(sessionId)`、`diff:get(file)`、`diff:revert(file|all)`、`editor:open(file)` |
| 插件 | `plugin:list/install/uninstall/enable/disable`、`plugin:invoke(id,method,args)`、`bus:publish/subscribe` |
| 设置 | `settings:get/set(partial)`、`settings:reset` |
| 认证 | `auth:setKey(provider,key)`、`auth:deleteKey(provider)`、`auth:list`、`auth:test(provider)` |
| 市场 | `market:search(q)`、`market:install(spec)`、`market:update(spec)` |

---

## 4. 三栏布局与组件树

### 4.1 布局底座

```
<AppShell>                                  // 顶栏（窗口控制/全局搜索/模型） + 三栏
├─ <TopBar>                                 // 面包屑(项目名·会话名) · 模型切换器 · 全局搜索(Alt+Space) · 设置入口
├─ <PanelGroup direction="horizontal">      // react-resizable-panels
│  ├─ <Panel defaultSize={22} minSize={12}> <LeftPane/> </Panel>
│  ├─ <PanelHandle/>                        // 拖拽分割条
│  ├─ <Panel defaultSize={48}> <CenterPane/> </Panel>
│  ├─ <PanelHandle/>
│  └─ <Panel defaultSize={30} minSize={15} collapsible> <RightPane/> </Panel>  // 右栏内部用 dockview 组织
├─ <StatusBar/>                             // 全局底部：model·thinking·context%·tokens·cost·插件状态位
└─ <CommandPalette/> <SettingsModal/> <Toaster/>   // 全局覆盖层
```

持久化：顶层三栏用 `react-resizable-panels` 的 `onLayout` 写回 `settings.window.layout`；右栏工作台的 tab/分组/浮动布局用 dockview 的 `serializeLayout()` / `loadLayout()` 持久化；三栏可折叠/可全屏某栏。

### 4.2 左栏：项目与会话（组件树）

```
<LeftPane>
├─ <ProjectPane>                            // 自绘列表（@tanstack/react-virtual）+ @dnd-kit 排序
│  ├─ <ProjectItem>  icon · 名称 · 信任徽标 · 当前会话数 · 上下文菜单
│  ├─ <AddProjectButton>                    // 打开文件夹选择器（dialog:openDirectory）
│  └─ <TrustBadge>                          // 未信任 → 点击弹 TrustDialog
├─ <SessionPane>                            // 当前项目会话
│  ├─ <SessionTree>                         // 树可视化：@tanstack/react-virtual + 缩进线
│  │  ├─ <SessionNode>
│  │  │  ├─ <NodeIcon>                      // user/assistant/tool/模型变更/压缩 分类图标
│  │  │  ├─ <NodeLabel>                     // 消息摘要（截断）· 书签标签 chips
│  │  │  ├─ <BranchMarker>                  // 分支点标识；active leaf 高亮
│  │  │  └─ <NodeMenu>                      // 从此处续写/打标签/复制为新会话/回滚到此处
│  │  └─ <BranchSummaryChip>                // 切走分支时生成的摘要气泡
│  └─ <SessionListHeader>                   // 新建/继续最近/搜索
├─ <HistoryPane>                            // 历史（虚拟列表）
│  ├─ <SessionListItem>                     // 名称·时间·消息数·tokens·cost·[分支]
│  └─ <HistoryFilters>                      // 搜索框 · 排序 · 仅命名会话 等（对齐 /resume 选择器）
└─ <LeftSidebarFooter>                      // 设置·插件·磁盘占用
```

状态：`useProjectStore` + `useSessionStore`。树数据来源：`engine:getState` + 会话 JSONL 解析（`SessionFileParser`）。

### 4.3 中栏：对话流（组件树）

```
<CenterPane>
├─ <MessageList>                            // useVirtualizer（scrollToIndex 跟随流式）
│  ├─ <MessageRow role=user|assistant|tool|system>
│  │  ├─ <UserMessage>                      // 头像·文本·附件图片·@引用 chips
│  │  ├─ <AssistantMessage>
│  │  │  ├─ <ThinkingBlock>                 // 可折叠"思考"；toggle
│  │  │  └─ <MarkdownBody>                  // streamdown + remark-gfm + Shiki 高亮
│  │  │     └─ <CodeBlock>                  // 语言角标 + 复制按钮 + 展开
│  │  ├─ <ToolCard>                         // 读文件/写文件/自定义工具
│  │  │  ├─ <ToolHeader>                    // 工具 icon · 名称 · 状态（spinner/✓/✗）
│  │  │  ├─ <BashCardBody>                  // bash：命令 + 实时输出 + exit code + "在终端重开"
│  │  │  ├─ <EditCardBody>                  // 内联 <InlineDiff> + [批准][拒绝]（见 §10.4）
│  │  │  ├─ <ReadCardBody>                  // 文件头 + 行号预览 + "在代码 Tab 打开"
│  │  │  └─ <ToolResultJSON>                // 可折叠原始结果 <pre>
│  │  └─ <ApprovalCard>                     // 权限门内联审批（见 §10.3）
│  └─ <PendingChips>                        // steer/follow-up 排队队列的可视 chips
├─ <Composer>                               // 输入区
│  ├─ <TextArea autoGrow>                   // 多行输入
│  ├─ <MentionMenu>                         // @ 联想项目文件（cmdk + fs:search）
│  ├─ <SlashMenu>                           // / 命令菜单（内建+扩展+Skill+模板）
│  ├─ <AttachmentChips>                     // 粘贴图片/拖入文件 → Attachment
│  ├─ <ModelSwitcher>                       // 当前模型 + 思考档位（Popover）
│  └─ <SendControls>                        // Enter=steer / Alt+Enter=follow 提示 + 发送/中止按钮
└─ <StatusBar>                              // model · thinking · context bar · tokens · cost
```

**流式渲染**：`EngineEvent.message_update(text_delta)` 追加到 `useSessionStore` 中当前 assistant 消息的 `streamBuffer`；`<MarkdownBody>` 交给 streamdown 内建流式管线（不完整 token 不闪烁、不闪原始字符），仅对静态段落用 `React.memo` 缓存。

### 4.4 右栏：多功能工作台（组件树）

```
<RightPane>
├─ <Dockview>                               // dockview：内建 tab 条/分组/拖拽停靠/浮动/popout/布局序列化
│  ├─ <BrowserPanel>  → <BrowserView>       // WebContentsView 宿主
│  ├─ <TerminalPanel> → <TerminalView>      // xterm.js
│  ├─ <FilesPanel>    → <FileExplorer>      // headless-tree
│  ├─ <CodePanel>     → <CodeEditorTabs>    // CodeMirror 6
│  ├─ <DiffPanel>     → <DiffView>          // @codemirror/merge
│  └─ <plugin-panels> → <PluginPanelHost>   // 插件注册的 tab
└─ （dockview 已支持上下拆分/浮动/popout，无需自绘 PanelSplit）
```

| Tab | 组件构成 | 关键 props |
|---|---|---|
| **BrowserView** | `<BrowserViewHost>`（把 WebContentsView 挂到容器 div）+ 地址栏 `<BrowserAddressBar>` + `<BrowserControls>`(后退/前进/刷新/新标签) | `viewId`、`url`、`loading`、`title`；agent 操作时显示"agent 驱动中"角标 |
| **TerminalView** | `<Terminal>`（xterm）+ fit addon + 右键菜单(复制/粘贴/搜索) + 新建/关闭 shell tab | `termId`、`cwd`、`shell`；支持"agent 镜像模式"开关 |
| **FileExplorer** | `<FileTree>`（headless-tree）+ 顶部 `<FileSearch>`（fzf 风格） | `cwd`、`gitignoreRules`、`openFiles`；双击 → CodeTab |
| **CodeEditorTabs** | `<EditorTabBar>` + `<CMPreview>`（只读，右键"编辑"）+ `<CMEdit>` | `file`、`readOnly`、`dirty`、`theme` |
| **DiffView** | `<FileDiffList>`（本次回合改动文件列表）+ `<CMDiffView>`（`@codemirror/merge`）+ `<RevertButton>` | `sessionId`、`selectedFile`、`before/after` |

**联动规则（workbench-store）**：`tool_execution_start(read)` → `editor:open(file)`；`tool_execution_start(edit)` → `diff:refresh(file)` + 切到 DiffTab；`tool_execution_start(bash)` → 若开启镜像则在 TerminalTab 追加。工作台布局变更走 dockview `onDidLayoutChange` 写回 `~/.pi-desktop/layout.json`。

---

## 5. Pi 生态接入设计

> 目标：**CLI 里装的扩展、Skill、主题、包，桌面原样可用；桌面装的插件 CLI 也能用。生态零分裂。**

### 5.1 生态接入总览

| 生态资产 | 官方存放位置 | 桌面接入方式 |
|---|---|---|
| Extensions | `~/.pi/agent/extensions/`、`.pi/extensions/`、settings `extensions` | `DefaultResourceLoader` 直接复用；`/reload` 热重载 |
| Skills | `~/.pi/agent/skills/`、`.pi/skills/`、`.agents/skills/` | 复用加载 + Skill 浏览器 UI |
| Prompt Templates | `~/.pi/agent/prompts/`、`.pi/prompts/` | 复用；`/模板名` 展开 |
| Themes | `~/.pi/agent/themes/`、`.pi/themes/` | 解析 token → 映射 CSS 变量 |
| Pi Packages | `pi install npm:.../git:...` → settings `packages` | 复用 package-manager；内置市场浏览 |
| Providers/Models | `models.json`、扩展 `registerProvider`、内置 15+ | 复用 `ModelRegistry`+`AuthStorage`；UI 化 |
| Sessions | `~/.pi/agent/sessions/**/*.jsonl`（树） | 复用 `SessionManager`；左栏树可视化 |

### 5.2 Extensions：100% 复用 + 桌面桥

- 加载：`DefaultResourceLoader`（`cwd`=当前项目，`agentDir`=应用管理的 `~/.pi/agent`），**不自写扫描器**。
- 能力对齐：`registerTool / registerCommand / registerShortcut / registerFlag / registerProvider`、`pi.on(事件)`、`ctx.ui.*`、`ctx.sessionManager`。
- **`ctx.ui` 桌面桥映射表**：

| Pi `ctx.ui` 方法 | CLI 表现 | 桌面实现 |
|---|---|---|
| `ctx.ui.notify(msg, kind)` | TUI 通知条 | `sonner` toast + 系统通知 |
| `ctx.ui.confirm(title, body)` | TUI 确认框 | 主进程 `dialog.showMessageBox` 或内联 `<ApprovalDialog>` |
| `ctx.ui.select(options)` | TUI 列表 | `<SelectDialog>`（Radix Dialog + 虚拟列表） |
| `ctx.ui.input(prompt)` | TUI 输入 | `<InputDialog>`（Radix Dialog + input） |
| `ctx.ui.custom(component)` | TUI 自定义组件 | v1 暂不支持 → 文档标注降级；v2 通过 `pi.desktop.ui.custom` 渲染 React 组件 |

- 热重载：`resourceLoader.reload()` + 重绑 session 事件 + 重启受影响的 `utilityProcess`。

### 5.3 Skills / Prompt Templates

- 复用 on-demand 加载（渐进披露，不爆 prompt cache）。
- 增值 UI：`<SkillsBrowser>`（Ctrl+Shift+S）——列表/搜索/说明/工具清单/启用开关（按项目覆盖）；`<TemplateManagerTab>`（新建/编辑/预览）。

### 5.4 Themes：token → CSS 变量映射

> 具体 token 名以 Pi Theme 文档/源码为准，此处给出语义映射表（实现时写一个 `theme-adapter.ts` 做归一化）。

| Pi 语义 token | CSS 变量 | 用于 |
|---|---|---|
| 前景/背景 | `--pi-fg` / `--pi-bg` | 全局文本/背景 |
| 主强调色 | `--pi-accent` | 焦点、选中、按钮主色 |
| 次级 | `--pi-muted-fg` / `--pi-muted-bg` | 次要文本/面板底 |
| 边框 | `--pi-border` | 分割线、卡片描边 |
| 成功/错误/警告 | `--pi-success` / `--pi-error` / `--pi-warning` | exit code、审批、状态 |
| 工具卡片分类色 | `--pi-tool-read/edit/bash/custom` | 工具卡片左侧色条 |
| 代码高亮 | `--pi-syntax-*` | Shiki 主题 / CodeMirror 6 theme 注入 |
| 终端 | `--pi-terminal-*` | xterm theme（`@xterm/xterm` CSS vars） |

- 实现：`ThemeProvider`（React Context）在应用启动时读取当前 Pi 主题 → 生成 `ThemeToken` 对象 → 写入 `:root` CSS 变量 + 传给 CodeMirror 6（`EditorView.theme` / CSS 变量直接生效）/ Shiki（`createHighlighter` 载入同名主题）/ xterm（`terminal.options.theme`）。
- 内置兜底：light / dark / system 三档。

### 5.5 Pi Packages 与市场

- 复用 `package-manager`：`pi install npm:@foo/pi-tools`、`pi install git:...`，写入 settings `packages`，生产安装（`--omit=dev`）。
- `<PackageMarket>`：浏览 pi.dev / npm 搜索 → 展示 description/author/stars/资源类型 → 安装/更新/卸载。
- 包 = 插件容器：一个包可带 extension+skill+theme，按 manifest 的 `pi` 字段分发到各资源加载器。

### 5.6 Providers / 多模型源

- 直接使用 `ModelRuntime`（配置 `authPath`/`modelsPath`/`credentials`）接入模型目录与凭据存储；`ModelRegistry` 类型用于可用模型查询（v2.2 修订：`createAgentSession` 无 `modelRegistry`/`authStorage` 选项）。
- 内置 15+ Provider：Anthropic / OpenAI / Google / Azure / Bedrock / Mistral / Groq / Cerebras / xAI / Hugging Face / Kimi / MiniMax / NVIDIA / OpenRouter / Ollama。
- 自定义：`models.json` 手写、扩展 `registerProvider()`（如连本地 `http://localhost:1234/v1`）、OpenAI 兼容端点 UI 表单。
- 密钥优先级（对齐 AuthStorage）：运行时覆盖 → 系统钥匙串（本应用替换 `auth.json`）→ 环境变量 → fallback resolver。

### 5.7 会话树与 Session Format

- 存储与官方完全一致：`~/.pi/agent/sessions/<cwd-组织>/<session>.jsonl`（树结构 `id`/`parentId`）。**桌面开始的会话 CLI 可 resume，反之亦然。**
- 左栏树可视化复用 `navigateTree(targetId, {summarize,label})`；分支摘要走 `session_before_tree` 事件钩子。

### 5.8 桌面扩展 API（超集）—— 类型定义

```ts
// packages/plugin-api/src/index.ts
export interface DesktopApi {
  panels: {
    register(def: PanelDefinition): Promise<void>;   // { id, title, icon, componentPath, permissions }
    open(id: string, params?: unknown): Promise<void>;
    close(id: string): Promise<void>;
  };
  statusbar: { setItem(id: string, def: StatusItem): Promise<void>; remove(id: string): Promise<void> };
  editor: { openFile(path: string, opts?: { focus?: boolean }): Promise<void> };
  terminal: { run(cmd: string, opts?: { cwd?: string; newTab?: boolean }): Promise<number> };
  browser: { navigate(url: string): Promise<void>; goBack(): Promise<void>; screenshot(): Promise<string> };
  diff: { show(beforePath: string, afterPath: string): Promise<void>; revert(file: string): Promise<void> };
  notify: (opts: { title: string; body?: string; kind?: "info"|"success"|"warning"|"error" }) => void;
  ui: { confirm(opts: { title: string; body: string }): Promise<boolean>; select<T>(opts: { options: T[]; render?: (t:T)=>string }): Promise<T|null>; input(opts: { prompt: string; defaultValue?: string }): Promise<string|null> };
  bus: { publish(topic: string, payload: unknown): Promise<void>; subscribe(topic: string, fn: (p: unknown)=>void): () => void };
  window: { setTitle(title: string): Promise<void>; setProgress(p: number|null): Promise<void> };
  invokeAgentTool(name: string, args: unknown): Promise<unknown>;   // 允许插件复用 agent 工具
  getPermissions(): Promise<string[]>;
}
```

- 兼容策略：扩展内 `if (pi.desktop) {...}` 优雅降级；仅 CLI 时跳过桌面分支。
- 运行时：`PluginHost`（utilityProcess）暴露，权限按 manifest 声明。

### 5.9 生态兼容性矩阵（验收口径）

| 兼容项 | CLI | 桌面 | 桌面额外 |
|---|---|---|---|
| 官方/第三方扩展 | ✅ | ✅ | 可访问 `pi.desktop.*` |
| Skills | ✅ | ✅ | Skill 浏览器 |
| Prompt Templates | ✅ | ✅ | 模板管理 |
| Themes | ✅ | ✅ | 可视化预览 |
| Pi 包（npm/git） | ✅ | ✅ | 市场 UI |
| 15+ Provider/自定义模型 | ✅ | ✅ | 模型/密钥设置 UI |
| 会话（JSONL 树） | ✅ | ✅ | 树可视化、分支/摘要 UI |

---

## 6. 插件系统设计（组件级）

### 6.1 插件 manifest（TS 类型）

```ts
// packages/plugin-api/src/manifest.ts
export interface PiPackageManifest {
  name: string; version: string;
  pi?: {
    extensions?: string[];          // Pi 扩展入口（LLM 工具/命令/事件）
    skills?: string[]; prompts?: string[]; themes?: string[];
    desktop?: {                     // 桌面扩展声明
      entry?: string;               // utilityProcess 入口
      panels?: PanelDefinition[];
      permissions?: PluginPermission[];
    };
  };
}
export type PluginPermission =
  | "fs:read" | "fs:write" | "terminal:run" | "network:fetch"
  | "browser:navigate" | "editor:open" | "notify" | "bus:*"
  | "agentTool:invoke" | "window:control";
```

### 6.2 权限模型

- 安装时审查：展示权限清单；未声明权限的 API 一律拒绝。
- 运行时提示：首次调用敏感 API 弹确认（"插件 X 想执行终端命令"）；可"本次/本次会话/总是允许"。
- 声明：插件是"用户可信代码"，非完整 OS 沙箱——市场页明示"只装信任来源"。

### 6.3 沙箱与进程隔离

- 每个插件 desktop 侧入口跑独立 `utilityProcess`；主进程只通过类型化 RPC 通信。
- 敏感能力（`terminal:run`/`fs:write`/`network`）由主进程代理执行，插件不持有原生句柄。
- LLM 侧工具（Pi extension）仍在主进程，但对 `bash`/写文件仍走审批门。

### 6.4 生命周期

```
安装 → 解包/装依赖 → 写 settings.packages
→ 启动：DefaultResourceLoader 发现 → desktop.entry 由 PluginHost 拉起
→ /reload：extension 侧 reload；desktop 侧重启 utilityProcess
→ 卸载：从 settings.packages 移除 + 清理
```

### 6.5 插件市场 UI

`<PackageMarket>` 组件：搜索框（cmdk）→ 结果列表（package card：名/描述/作者/star/权限清单/安装按钮）→ 已安装 Tab（启用/禁用/卸载/检查更新）。

---

## 7. 大模型源管理（组件级）

### 7.1 设置页组件树

```
<SettingsModal>                       // Radix Dialog，全屏
└─ <SettingsTabs>                     // 左侧纵向 Tab（Radix Tabs）
   ├─ <ModelsTab>
   │  ├─ <ProviderList>               // 表格：Provider · 状态(有Key/无Key) · 默认模型 · 操作
   │  ├─ <ProviderForm>               // react-hook-form+zod：名称/BaseURL/API风格/模型列表
   │  │  ├─ <ModelRowsEditor>         // 手动增删 或 "从 /v1/models 拉取"
   │  │  └─ <Field key=...>           // 密钥输入（password 类型 → keychain 写入）
   │  └─ <TestConnectionButton>
   ├─ <ExtensionsTab> <SkillsTab> <ThemesTab> <PackagesTab> <PermissionsTab> <GeneralTab>
   └─ ...
```

### 7.2 数据模型

```ts
export interface ProviderConfig {
  id: string; name: string;
  apiStyle: "anthropic" | "openai-completions" | "custom";
  baseUrl?: string;
  models: ModelConfig[];
}
export interface ModelConfig {
  id: string; name: string;
  reasoning: boolean;
  input: string[];                       // ["text","image"]…
  contextWindow: number; maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  favorite?: boolean;                    // 进 Ctrl+P 循环
}
```

- 存储：Provider/Model 写 Pi 兼容的 `models.json`；仅 UI 字段（favorite、排序）写 `~/.pi-desktop/settings.json`；密钥写系统钥匙串。

### 7.3 运行中切换

- `Ctrl+L` 模型切换器 = Pi model selection（`modelRegistry.getAvailable()`）。
- `Ctrl+P` 循环收藏模型 = Pi `scopedModels`。
- 思考档位切换 = `setThinkingLevel`，**档位列表运行时动态获取**（RPC `get_available_thinking_levels` / SDK 对应 API），不硬编码（v2.2 修订）。
- 换模型/换档位记录为会话 entry，可在树里回溯。

---

## 8. 数据与存储（含 Zustand stores）

### 8.1 存储分布

| 数据 | 位置 | 说明 |
|---|---|---|
| 会话（权威） | `~/.pi/agent/sessions/` | Pi JSONL 树，CLI/桌面互通 |
| 扩展/Skill/模板/主题/包配置 | `~/.pi/agent/` | 与 CLI 共用 |
| 密钥 | 系统钥匙串 + 环境变量 | 仅无钥匙串环境回退 `auth.json` |
| 应用 UI 状态 | `~/.pi-desktop/`（settings.json / projects.json / layout.json） | 与 Pi 配置分离 |
| 搜索索引（可选） | `~/.pi-desktop/index.sqlite` | 会话全文索引 |

```jsonc
// ~/.pi-desktop/settings.json（概要）
{
  "window": { "layout": [22, 48, 30], "rightCollapsed": false },
  "theme": { "source": "pi-theme:tokyonight", "fallback": "dark" },
  "approval": { "defaultPolicy": "high-risk", "rules": [{ "pattern": "rm -rf", "policy": "ask" }] },
  "terminal": { "shell": "powershell", "mirrorAgentBash": false },
  "browser": { "userDataDir": "~/.pi-desktop/browser-profile" },
  "editor": { "fontSize": 14, "tabSize": 2 },
  "recentProjects": []
}
```

### 8.2 Zustand stores

```ts
useProjectStore  // projects[], activeProject, trustMap, treeData
useSessionStore  // activeSessionId, messages(UIMessage[]), streamBuffer, pendingSteer/FollowUp, state/stats
useWorkbenchStore// tabs[], activeTab, openFiles, diffList, browser/tty 状态
useModelStore    // availableModels, currentModel, thinkingLevel, favorites
useSettingsStore // settings, theme tokens
usePluginStore   // plugins[], permissions, bus 订阅注册表
```

### 8.3 消息归一化模型

```ts
export type UIMessage =
  | { kind: "user"; id: string; text: string; attachments?: Attachment[] }
  | { kind: "assistant"; id: string; thinking?: string; text: string; streaming: boolean }
  | { kind: "tool"; id: string; toolName: string; input: unknown; status: "running"|"ok"|"error"; output?: string }
  | { kind: "bash"; id: string; command: string; output: string; exitCode: number|null; mirror?: boolean }
  | { kind: "system"; id: string; text: string; tone: "info"|"model"|"compact" };
```

> `normalizeEntry(entry: SessionEntry): UIMessage` 放在 `packages/engine`，为未来新增 Pi 类型留适配位。

---

## 9. 权限与安全（组件级）

| 风险 | 对策 |
|---|---|
| 恶意 `.pi` 配置/扩展 | 复用 Pi 项目信任（`project_trust` 事件 + `trust.json`）；未信任不加载 `.pi/*` 动态配置；`<TrustDialog>` 首次打开项目时弹出 |
| agent 执行危险命令 | `tool_call` 拦截 → `<ApprovalCard>`；策略四档（全自动/高风险审批/全部审批/全部拒绝）；未响应默认拒绝 |
| agent 改写敏感文件 | 内置 path-guard 扩展：`.env`、`node_modules/`、`.git/`、`~/.ssh` 等默认写保护 |
| 插件越权 | manifest 权限 + utilityProcess 隔离 + 敏感 API 主进程代理 |
| API Key 泄露 | 系统钥匙串（Electron `safeStorage`：Windows=DPAPI / macOS=Keychain / Linux=secret service） |
| 会话隐私 | 纯本地，无遥测；导出/删除到回收站 |
| 升级兼容 | Pin Pi SDK 版本 + 升级回归清单；RPC 模式异常降级 |

---

## 10. 核心模块实现细节（技术难点逐项）

### 10.1 浏览器面板 + Agent 浏览器工具（难度：高）

- **显示层**：Electron `WebContentsView`（≥30），由 `<BrowserViewHost>` 通过 IPC 创建，主进程 `view.setBounds(rect)` 与容器 div 的 `getBoundingClientRect()` 同步（窗口 resize / 面板拖拽时重新 setBounds）。
- **自动化层**：`webContents.debugger.attach("1.3")` + CDP 客户端（`chrome-remote-interface` 或 `playwright-core` 的 CDP 会话）执行：
  - `Page.navigate`、`Runtime.evaluate`（DOM 提取）、`Input.dispatchMouseEvent`/`dispatchKeyEvent`（点击/输入）、`Page.captureScreenshot`（发给 LLM，压缩降采样控 token）、`DOM.getDocument`+`DOM.querySelector`（元素定位）。
- **工具暴露**（`registerTool`，TypeBox 参数）：

```ts
pi.registerTool({
  name: "browser_navigate",
  description: "Navigate the visible browser panel to a URL",
  parameters: Type.Object({ url: Type.String() }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    await browserService.navigate(params.url);
    const shot = await browserService.screenshot();
    return { content: [{ type: "text", text: `Navigated to ${params.url}` }, { type: "image", data: shot, mimeType: "image/png" }], details: {} };
  },
});
// browser_click / browser_type / browser_read(DOM 文本) / browser_screenshot / browser_eval
```

- 边界：登录态复用用户已登录的 WebContentsView（共享 session）；高风险动作（登录/支付）归入审批门；iframe 处理经 CDP target 切换。
- 备选：独立 headless Playwright Chromium + 截图轮询（复杂度低，实时性差）——留作 fallback。

### 10.2 终端面板（难度：中）

- `node-pty`（主进程）按 Electron ABI 重编译；Windows 用 ConPTY；shell 默认 PowerShell（可配 cmd/Git Bash/WSL）。
- 渲染层 `@xterm/xterm` + addons（fit/web-links/search/unicode11/clipboard）。
- 数据通路：`term:create` → 返回 `termId`；pty `onData` → `term:onData` 事件 → xterm `write()`；xterm 输入 → `term:write` → pty `write()`。
- agent `bash` 与用户终端解耦；开启"镜像"时 agent bash 输出实时转发到终端 Tab。
- 会话保活：按项目维护 terminal tab；长任务与用户操作互不阻塞。

### 10.3 审批门（难度：中高）

- 用**内置 Pi 扩展**实现（`extensions/permission-gate.ts`），在 `pi.on("tool_call")` 拦截：

```ts
pi.on("tool_call", async (event, ctx) => {
  const req = classify(event);                    // bash/write/read/自定义
  if (policy(req) === "allow") return;            // 命中总是允许
  if (policy(req) === "deny")  return { block: true, reason: "Denied by policy" };
  const decision = await approvalService.ask(req); // → IPC → 渲染层 <ApprovalCard> → await 用户
  if (!decision.allow) return { block: true, reason: decision.reason ?? "Denied by user" };
});
```

- `approvalService.ask` 是主进程服务：向渲染层发 `approval_request` 事件，挂起 Promise；渲染层 `<ApprovalCard>` 返回后 resolve（带超时/默认拒绝）。
- 会话级授权：请求携带 `scope`，用户选"本次会话批准"时写入 `sessionScopeAllowlist`。

### 10.4 代码编辑快照与 Diff / 回滚（难度：中）

- `snapshot-service`：在 `tool_execution_start(edit/write)` 时读"改前内容"入内存 map（`Map<sessionId+toolCallId, {path,before}>`）；`tool_execution_end` 时读"改后内容"写入 diff 队列。
- 渲染：卡片内 `<InlineDiff>` 用 `diff`(jsdiff) + 自绘行级渲染（轻量）；右栏 `<DiffView>` 用 `@codemirror/merge`（MergeView，CSS 变量主题随全局）。
- 回滚：`diff:revert(file)` → 主进程用 before 快照写回文件，并追加一条系统消息"已回滚 X"。

### 10.5 扩展运行时（难度：高）

- Pi 扩展用 `jiti` 加载 TS、依赖 npm 包 → 主进程需可解析 `node_modules`（工作目录/Pi 目录）。
- 桌面 `ctx.ui` 桥接：TUI 组件 → 原生/应用内弹层（见 §5.2 映射表），扩展代码零改动。
- 插件 desktop 侧跑 utilityProcess：类型化 RPC、权限检查、崩溃恢复（`process.on("exit")` → 重启 + 通知）。

### 10.6 Windows 适配（当前用户平台）

- 路径：`getAgentDir()` 在 Windows 取 `%USERPROFILE%\.pi\agent`（验证）；统一用 `expandHome()`。
- shell：bash 工具默认解析 git-bash/wsl/powershell 三选一（设置可改）；pty 用 ConPTY。
- 密钥：`safeStorage` 走 DPAPI。
- 打包：NSIS + 签名；jiti/原生模块在 Electron 下重建（`electron-rebuild` / `electron-builder install-app-deps`）。

---

## 11. 关键交互细节（Codex 对齐清单）

1. **流式体验**：thinking 折叠块 + 正文增量渲染；虚拟列表万条消息不卡。
2. **工具卡片**：read/edit/bash 卡片可展开收起；bash 卡片实时输出 + exit code。
3. **内嵌 diff**：每次文件编辑，卡片与右栏 Diff 同时出现；guard rollback。
4. **steer / follow-up**：与 Pi 排队语义一致；输入区视觉区分。
5. **审批流**：不打断对话流的悬浮审批卡片；批量/会话级授权。
6. **命令面板**：`Ctrl+Shift+P` 聚合：应用命令 + Pi 命令 + 扩展命令 + Skill + 模板 + 插件动作。
7. **@ 引用**：输入 `@` 联想项目文件；粘贴图片进会话。
8. **模型状态常驻**：状态栏与输入区右上角显示当前模型/档位，点击切换。
9. **会话树操作**：右键消息 → 从此处分支 / 复制为新会话 / 打标签 / 回滚到此处。
10. **键盘优先**：Tab 循环三栏焦点；全应用 90% 操作可键盘完成。

---

## 12. 里程碑路线图

### Phase 0 · 技术验证（3~5 天）
- [ ] 主进程 `createAgentSession()` 跑通一次 prompt，订阅事件流
- [ ] `DefaultResourceLoader` 加载一个官方示例扩展；`ctx.ui.notify` 桥到渲染层
- [ ] node-pty 在 Windows 按 Electron ABI 编译通过
- **验收**：Electron 内完成"用 Pi 改一个文件"，工具卡片 + diff 上屏。

### Phase 1 · 三栏骨架 + 对话闭环（1~2 周）
- [ ] 布局底座（react-resizable-panels 三栏 + dockview 工作台）+ 顶栏/状态栏
- [ ] 左栏：项目 + 会话列表/树/分支
- [ ] 中栏：流式对话、工具卡片、输入区（@引用、/命令、Enter/Alt+Enter）
- **验收**：日常"改 bug/加功能"在 GUI 完成，CLI 可 resume 同一会话。

### Phase 2 · 多功能工作台（1~2 周）
- [ ] 文件树（headless-tree）+ 代码预览（CodeMirror 6）+ 工作台 dockview 停靠布局
- [ ] 终端面板（xterm + pty）
- [ ] Diff Tab + guard rollback
- [ ] 浏览器面板 + `browser_*` 工具（CDP 桥）
- [ ] agent 动作→右栏联动
- **验收**：agent 跑一个 Web 项目（改代码→跑测试→浏览器验证）全程在桌面内闭环。

### Phase 3 · 生态接入（1~2 周）
- [ ] extensions/skills/prompts/themes/packages 全量复用 + 管理 UI
- [ ] 模型源设置 + 密钥钥匙串 + 自定义/本地 Provider
- [ ] 主题 token 映射
- [ ] 包市场
- **验收**：装一个社区 Pi 包，扩展+主题+Skill 全生效；CLI/桌面互通。

### Phase 4 · 权限与高级模式（1 周）
- [ ] 审批门 + 策略四档 + 路径保护
- [ ] 项目信任流程
- [ ] 计划模式（内置扩展：检查→不可变计划→批准→执行）
- [ ] 可选：子代理（扩展 spawn Pi 实例 / 多会话工作树）
- **验收**：权限矩阵用例全过；危险命令/敏感文件默认拦截。

### Phase 5 · 打磨与分发（1~2 周）
- [ ] 命令面板、全局搜索、会话导入/导出/分享
- [ ] 插件桌面 API 稳定化 + 示例插件
- [ ] electron-builder 三平台打包 + 自动更新
- [ ] 文档 + 上手指引
- **验收**：干净安装三平台，新用户 10 分钟跑通。

---

## 13. 团队与技能

| 角色 | 技能 | 人数 |
|---|---|---|
| 桌面全栈 | Electron + React + TS + Node | 1~2 |
| 引擎集成 | Pi SDK/RPC、扩展 API、OpenClaw 参考 | 1（可复用） |
| 面板开发 | xterm.js / CodeMirror 6 / dockview / Playwright-CDP / node-pty | 1 |
| 设计 | 三栏交互、主题系统、动效 | 0.5 |

---

## 14. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| Pi 版本迭代快，SDK API 变动 | 高 | Pin 版本 + 跟随 CHANGELOG；EngineAdapter 隔离；升级回归清单 |
| 扩展在 Electron 内运行兼容（jiti/npm/原生模块） | 中高 | 先跑通官方示例扩展；复杂扩展走 RPC 兜底 |
| `ctx.ui` 桌面桥接工作量 | 中 | 先只桥 notify/confirm/select/input，custom 组件后续 |
| node-pty Windows ABI | 中 | Phase 0 验证；prebuilt/electron-rebuild |
| WebContentsView 布局同步（面板拖拽时 setBounds） | 中 | BrowserViewHost 用 ResizeObserver + rAF 同步；提供"脱离布局独立窗口"模式兜底 |
| 新库较年轻（streamdown/dockview/headless-tree） | 中 | 均有成熟兜底（react-markdown+Shiki / react-resizable-panels / 自绘树）；UI 层组件抽象隔离，可随时切换 |
| 浏览器自动化被反爬/登录拦截 | 中 | 复用用户登录态；高风险动作走审批门；不承诺破解验证 |
| 与既有桌面产品混淆 | 中 | 传播定位："官方 Pi 内核 + IDE 三栏 + 面板即 agent 工具" |

---

## 15. 参考资源

- Pi 官网与文档：https://pi.dev/ （Overview / Extensions / Skills / Themes / Pi Packages / Providers / Sessions / SDK / RPC）
- GitHub：https://github.com/earendil-works/pi （MIT）
- RPC 协议：https://pi.dev/docs/latest/rpc
- SDK：https://pi.dev/docs/latest/sdk
- 扩展 API：https://pi.dev/docs/latest/extensions
- 会话与树：https://pi.dev/docs/latest/sessions
- OpenClaw（SDK 嵌入参考）：https://openclawlab.com/en/docs/pi/
- 已存在产品（差异参考）：PI-Desktop https://github.com/vastsa/PI-Desktop ；Pi Agent Desktop https://pi-desktop.app/
- 组件库参考（选型依据）：dockview / react-resizable-panels / @tanstack/react-virtual / streamdown / Shiki / CodeMirror 6 / @codemirror/merge / headless-tree / @xterm/xterm / cmdk / Radix UI / sonner / dnd-kit / electron-trpc / Zustand

---

*本方案中的 Pi 能力描述依据 pi.dev 官方文档（2026-08-30 检索）；组件选型为稳定主流库，实际以接入时版本为准。*
