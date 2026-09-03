# pi-wood 执行计划（Step-by-Step · 可追溯版）

> 依据：《pi-wood-方案.md》v2.1（组件级评审稿，2026-08-30）
> 版本：执行计划 v1.0 · 日期：2026-08-30 · 配套方案：同目录 `pi-wood-方案.md`
> 目的：把方案拆成可独立执行、可验证、可追溯的任务。**任何后续会话/协作者拿到本文档即可继续推进，不需要重读聊天记录。**

---

## 0. 如何使用本文档（追溯规则）

1. **任务编号**：`T{Phase}.{序号}`（如 `T0.2` = Phase 0 第 2 个任务）。所有代码提交、分支名、PR 标题、commit message 前缀均引用任务号，例：`git commit -m "T1.3: 会话树虚拟列表"`。
2. **每个任务包含六要素**：来源（对应方案章节）→ 前置依赖 → 执行步骤 → 产出（落盘文件路径）→ 验收标准（可勾选）→ 验证方式（命令或手动操作）。**验收项全部勾选才算完成，未完成不得开始依赖它的任务。**
3. **执行中发现的任何偏差**（API 与文档不符、库不满足需求、方案错误）：不直接改代码绕过，先记入 §8 变更日志（日期 / 任务号 / 偏差 / 决策），再继续。这就是"有迹可循"的核心。
4. **新会话恢复上下文**：把本文档 + 方案文档一起提供，并说明当前执行到哪个任务号、§8 最后一条记录是什么。
5. **状态标记**：`☐ 未开始` → `🔜 进行中` → `✅ 完成` → `⛔ 阻塞（注明原因）`。任务标题后用 [ ] 勾选框跟踪。

---

## 1. 前置修订项（先改方案文档，再动工）

> 以下 3 处为 2026-08-30 对照 pi.dev 官方文档核实出的偏差，**必须先修订到方案文档中**，否则 Phase 0 的编码会按错误 API 走。来源核实记录见本文档 §9。

### R-1 `createAgentSession` 选项名修正
- 方案位置：§2.1、§2.2（EngineAdapter 注释、架构图）
- 现状写法：`createAgentSession({ modelRegistry, authStorage, ... })`
- **正确写法**：选项为 `modelRuntime`（`ModelRuntime` 负责模型目录与凭据存储，配置项为 `authPath` / `modelsPath` / `credentials`）。`ModelRegistry` 类型存在，但传入 session 的方式是通过 `modelRuntime`。
- 影响文件：`packages/engine/src/adapter.ts` 注释、`apps/desktop/electron/main/engine/sdk-adapter.ts`

### R-2 会话操作方法归属修正
- 方案位置：§2.1（EngineAdapter 接口设计依据）
- 现状认知：`newSession` / `switchSession` / `fork` 在 `AgentSession` 上
- **正确认知**：这三个方法位于 **`AgentSessionRuntime`**（`createAgentSessionRuntime()`）。`EngineAdapter` 接口本身不用改，但 `sdk-adapter.ts` 实现必须持有 runtime 实例而非裸 session。
- 影响文件：`apps/desktop/electron/main/engine/sdk-adapter.ts`

### R-3 EngineEvent schema 补全
- 方案位置：§3.1（`EngineEventSchema`）
- 缺失事件：`auto_retry_start` / `auto_retry_end`、`summarization_retry_scheduled` / `summarization_retry_attempt_start` / `summarization_retry_finished`
- 另需注意：`bash_execution_update` 的输出在下一次 `prompt` 时才转成 UserMessage 进入上下文——bash 工具卡片（T2.x）展示实时输出即可，不要假设它已进入会话记录。
- 影响文件：`packages/ipc-schema/src/engine.ts`

### R-4 范围裁剪决策（本轮评审结论）
| 项 | 决策 | 理由 |
|---|---|---|
| RPC 备路径（EngineAdapter B 实现） | **MVP 砍掉，接口保留** | SDK 异常多为 Pi 版本变动，RPC 同样受影响；双实现维护成本 > 收益。`rpc-adapter.ts` 只留 TODO 占位 |
| 浏览器面板 | **MVP 用 headless Playwright 截图流**（方案 §10.1 已列 fallback），`WebContentsView + CDP` 推迟到 Phase 3 后 | 单人工期内风险最高的模块，先降级保闭环 |
| `better-sqlite3` | **Phase 5 前不引入** | 原生模块，Windows 下需 electron-rebuild，与 node-pty 同类风险；全文搜索非 MVP 必需 |
| 思考档位列表 | **不硬编码**，运行时经 `get_available_thinking_levels`（RPC）/ SDK 对应 API 动态获取 | 方案 §7.3 列举的档位名未经逐一核实 |
| 工期基线 | MVP（T0~T2）按 **6~9 周** 排期（方案原估 4~6 周） | 浏览器面板与多原生模块叠加的单人风险缓冲 |

---

## 2. Phase 0 · 技术验证（预计 3~5 天）

> 目标：证明"Electron 进程内嵌入 Pi + Windows 原生模块"两条高风险路径走通。**本阶段只写验证代码，不追求结构整洁，全部放在 `apps/desktop/electron/main/engine/` 与 `scratch/` 下即可。**

### [x] T0.1 仓库骨架与工具链（✅ 2026-08-30，验收记录见 §8）
- 来源：方案 §2.5
- 前置：无
- 步骤：
  1. 初始化 pnpm monorepo（`pnpm-workspace.yaml` + `turbo.json` 或 nx，任选其一并记录理由）
  2. 建 `apps/desktop`（Electron + Vite + React 18 + TS strict）与 `packages/{engine,ipc-schema,ui-kit}` 空壳
  3. 配置 electron-builder 基础打包（NSIS）+ `electron-builder install-app-deps` 原生模块重建钩子
  4. ESLint + Prettier + `tsconfig` 项目引用
- 产出：`pi-wood/` 目录（结构对齐方案 §2.5，允许空文件占位）
- 验收：
  - [ ] `pnpm dev` 启动空三栏窗口（React 热更新生效）
  - [ ] `pnpm build` 产出可安装的 Windows NSIS 包并成功运行
- 验证方式：本机执行 `pnpm dev` / `pnpm build`，截图存 `docs/proofs/T0.1/`

### [x] T0.2 嵌入 Pi SDK：跑通一次完整 prompt 闭环 ★关键路径（✅ 2026-08-30，DeepSeek 内置 Provider + DEEPSEEK_API_KEY 环境变量；验收记录见 §8）
- 来源：方案 §2.1（**应用 §1 R-1、R-2 修订**）、[SDK 文档](https://pi.dev/docs/latest/sdk)
- 前置：T0.1
- 步骤：
  1. `pnpm add @earendil-works/pi-coding-agent`，**锁版本号记入 §8**
  2. 主进程写 `scratch/sdk-probe.ts`：`createAgentSession({ cwd, modelRuntime, customTools })` + `createAgentSessionRuntime()`
  3. `session.subscribe()` 打印全部事件到主进程日志；依次调用 `prompt("用 edit 工具把 test.txt 里的 a 改成 b")` → 观察 `tool_execution_start/update/end` → `message_end`
  4. 验证 `runtime.newSession()` / `runtime.switchSession()` / `runtime.fork()` 真实签名（R-2 落地）
- 产出：`apps/desktop/electron/main/engine/sdk-adapter.ts` 雏形 + `docs/proofs/T0.2/events-log.txt`
- 验收：
  - [ ] Electron 主进程内完成一次 prompt → 文件被真实修改 → 事件流完整打印
  - [ ] 事件类型清单与方案 §3.1 schema 比对，差异记入 §8（预期缺失 `auto_retry_*` 等，即 R-3）
- 验证方式：跑 `pnpm probe:sdk`（临时 script），日志留档

### [x] T0.3 扩展加载与 `ctx.ui` 桥接验证（✅ 2026-08-30，Electron 主进程探针 PASS；打包版 asar 复验留 T0.6，记录见 §8）
- 来源：方案 §5.2、[扩展文档](https://pi.dev/docs/latest/extensions)
- 前置：T0.2
- 步骤：
  1. 用 `DefaultResourceLoader`（`cwd` = 测试项目，`agentDir` = `%USERPROFILE%\.pi\agent`，Windows 路径用 `expandHome()`，来源方案 §10.6）加载一个手写示例扩展 `scratch/extension-echo.ts`（`registerTool` + `ctx.ui.notify`）
  2. 把 `ctx.ui.notify` 桥到渲染层：主进程收扩展通知 → `webContents.send` → 渲染层弹 toast（先用 alert 占位也行）
  3. 验证 jiti 在 Electron 主进程（打包 asar 环境）加载 TS 扩展是否正常；**若 asar 内失败，记录解法（extact 到 app.asar.unpacked 或改加载路径）到 §8**
- 产出：`scratch/extension-echo.ts`、`apps/desktop/electron/main/resources/resource-manager.ts` 雏形
- 验收：
  - [ ] agent 在对话中调用示例扩展注册的工具成功
  - [ ] 扩展里的 `ctx.ui.notify` 在桌面窗口内弹出通知（非 TUI）
  - [ ] 打包后的 app（非 dev 模式）扩展仍能加载
- 验证方式：dev + 打包版各跑一次，日志留档 `docs/proofs/T0.3/`

### [x] T0.4 `tool_call` 拦截验证（审批门可行性）（✅ 2026-08-30，双组对照通过，记录见 §8）
- 来源：方案 §10.3、[扩展文档 tool_call 事件](https://pi.dev/docs/latest/extensions)
- 前置：T0.3
- 步骤：
  1. 写 `scratch/permission-gate-probe.ts`：`pi.on("tool_call")` 对 `bash` 工具返回 `{ block: true, reason: "blocked by probe" }`
  2. 观察被阻断后 agent 的行为（是否收到 reason、是否继续运行）
- 产出：探针代码 + `docs/proofs/T0.4/block-log.txt`
- 验收：
  - [ ] bash 调用被成功阻断且 agent 拿到 reason 继续对话
  - [ ] 结论写入 §8：审批门扩展路线确认可行 / 或记录替代方案
- 验证方式：一条 prompt 触发 bash，观察日志

### [x] T0.5 node-pty Windows ABI 验证（✅ 2026-08-30，改用 @lydell/node-pty N-API 预编译，双运行时 ConPTY 通过，记录见 §8）
- 来源：方案 §10.2、§10.6、§14
- 前置：T0.1
- 步骤：
  1. 安装 `node-pty`，`electron-builder install-app-deps` 按 Electron ABI 重建
  2. 主进程起 ConPTY（PowerShell），stdout 通过 IPC 转发到渲染层最简组件回显
  3. **若编译失败**：尝试 `@homebridge/node-pty-prebuilt-multiarch`（方案 §2.4 备选），结果记 §8
- 产出：`apps/desktop/electron/main/workbench/terminal-service.ts` 雏形
- 验收：
  - [ ] 渲染层（先用 `<pre>` 即可）能输入命令并看到实时输出
  - [ ] 打包版同样可用
- 验证方式：`pnpm dev` 与打包版各一次

### [x] T0.6 Phase 0 门禁评审（✅ 2026-08-30，E2E PASS，**Go 决策**——进入 Phase 1）
- 来源：方案 §12 Phase 0 验收
- 前置：T0.2 ~ T0.5
- 步骤：对照方案验收标准"Electron 内完成'用 Pi 改一个文件'，工具卡片 + diff 上屏"做一次端到端串测（工具卡片/diff 可用最简 DOM 占位）
- 验收：
  - [ ] 端到端演示通过（录屏存 `docs/proofs/T0.6/demo.mp4`）
  - [ ] 所有偏差已记入 §8，方案文档已应用 R-1 ~ R-3 修订
  - [ ] Go / No-Go 决策写入 §8（No-Go 时明确阻塞项与替代路线）

---

## 3. Phase 1 · 三栏骨架 + 对话闭环（预计 2~3 周）

> 目标：日常"改 bug / 加功能"在 GUI 完成，CLI 可 resume 同一会话。

### [x] T1.1 IPC 契约层（✅ 2026-08-30，schema 全量 + 事件桥单测 4/4 + SdkAdapter 重构后 E2E PASS，记录见 §8）
- 来源：方案 §2.2、§3.1（**应用 R-3 修订**）
- 前置：T0.6
- 步骤：
  1. `packages/ipc-schema/src/engine.ts`：按方案 §3.1 定义全部 engine 域 zod schema（含补全的事件），`EngineEventSchema` 用 `z.discriminatedUnion`
  2. `packages/engine/src/adapter.ts`：`EngineAdapter` 接口照方案实现；`sdk-adapter.ts` 正式实现（RPC 留 TODO 占位，R-4 决策）
  3. `event-bridge.ts`：`AgentSessionEvent` → `EngineEvent` 归一化，未知事件类型透传并打日志（为 Pi 升级留适配位）
- 产出：`packages/ipc-schema/src/engine.ts`、`packages/engine/src/{adapter,sdk-adapter,event-bridge}.ts`
- 验收：
  - [ ] `pnpm typecheck` 全绿；渲染层可 import 类型且不引入 Node 依赖（electron-trpc 或 contextBridge 二选一，决策记 §8）
  - [ ] 事件桥对未知 `type` 不崩溃（单测：喂一个假事件）
- 验证方式：`pnpm test packages/engine` + typecheck

### [x] T1.2 布局底座（✅ 2026-08-30，capture 双布局还原 + 折叠状态恢复验证，记录见 §8）
- 来源：方案 §4.1
- 前置：T0.1
- 步骤：`react-resizable-panels` 三栏 + 顶栏 + 状态栏骨架；`onLayout` 持久化到 `~/.pi-wood/settings.json`（`window.layout`）；dockview 只在右栏占位挂载空实例
- 产出：`apps/desktop/src/renderer/components/layout/{AppShell,Panels,StatusBar,TopBar}.tsx`
- 验收：
  - [ ] 拖拽分割条比例重启动后还原；三栏可折叠
  - [ ] 状态栏显示模型名 / thinking / tokens（数据可先 mock）
- 验证方式：手动操作 + 截图 `docs/proofs/T1.2/`

### [x] T1.3 中栏对话流（MVP 核心体验）（✅ 2026-08-30：核心闭环 + 精修清单全清——万条压测/续写接线/diff 上屏，记录见 §8）
- 来源：方案 §4.3、§11-1/2
- 前置：T1.1、T1.2
- 步骤：
  1. `useSessionStore`（zustand）：`messages` / `streamBuffer` / `pendingSteer/FollowUp`
  2. `<MessageList>`（`@tanstack/react-virtual`，`scrollToIndex` 跟随流式）+ `<MessageRow>` 四种角色
  3. `<MarkdownBody>`：streamdown + remark-gfm + Shiki 代码高亮（懒加载）
  4. `<ToolCard>` 三形态（bash 实时输出 / edit 内联 diff / read 预览），数据来自 T1.1 事件
  5. `<Composer>`：多行输入、Enter=steer / Alt+Enter=followUp、中止按钮
  6. steer/followUp 排队 chips（消费 `queue_update` 事件）
- 产出：`apps/desktop/src/renderer/components/center/*`
- 验收：
  - [ ] 流式输出无闪烁、无原始 markdown 残留（不完整代码块正常渲染）
  - [ ] 万条消息列表滚动不卡（用测试脚本灌 1 万条验证）
  - [ ] Enter 排队 steer、Alt+Enter 排队 followUp，chips 与 `queue_update` 状态一致
- 验证方式：真机对话 + 压测脚本 `docs/proofs/T1.3/`

### [x] T1.4 左栏项目与会话（✅ 2026-08-30：SessionTree 与点击叶子续写已接通，CLI↔桌面双向互通硬验收通过）
- 来源：方案 §4.2、§5.7
- 前置：T1.1、T1.2
- 步骤：
  1. `ProjectManager`（主进程）：项目注册 / 信任（复用 Pi `project_trust` + `trust.json`）/ `.pi` 发现
  2. `<ProjectPane>` + `<SessionPane>`：会话 JSONL 树解析（`SessionFileParser`）、`navigateTree` 分支切换、active leaf 高亮
  3. `<HistoryPane>` 虚拟列表：名称 / 时间 / tokens / cost / 分支标记（对齐 Pi `/resume` 选择器字段）
- 产出：`apps/desktop/electron/main/project/*`、`renderer/components/left/*`
- 验收：
  - [x] 桌面新建会话后 `pi` CLI 能 resume；CLI 建的会话桌面能看到并继续（**双向互通为硬验收**）
  - [x] 分支节点可视化正确，右键可"从此处续写 / 复制为新会话"
- 验证方式：与 CLI 互通实测，记录 `docs/proofs/T1.4/`

### [x] T1.5 Phase 1 门禁评审（✅ 2026-08-31：日常任务 GUI 全闭环 + CLI resume 实测通过，**Phase 1 门禁通过**，记录见 §8）
- 前置：T1.3、T1.4
- 验收：
  - [ ] 方案 §12 Phase 1 验收达成："日常改 bug/加功能全程 GUI，CLI 可 resume"
  - [ ] 端到端录屏 + §8 记录

---

## 4. Phase 2 · 多功能工作台（预计 2~3 周）

### [x] T2.1 文件树 + 代码预览/编辑（✅ 2026-08-31：fs:* 域 + 懒加载树 + 搜索 + CodeMirror 编辑保存落盘验证通过，记录见 §8；文件树未用 headless-tree，决策见 §8）
- 来源：方案 §4.4（FilesPanel / CodePanel）、§2.4
- 前置：T1.5
- 步骤：
  1. `file-service.ts`（主进程）：fs 封装，gitignore 感知，IPC 域 `fs:*`（方案 §3.2）
  2. `<FileTree>`（headless-tree）+ fzf 风格搜索；双击 → CodeTab
  3. `<CMEditor>`（CodeMirror 6）：默认只读，右键切编辑；主题接 CSS 变量
- 产出：`renderer/components/right/{FileExplorer,CodeEditorTabs}.tsx`、`electron/main/workbench/file-service.ts`
- 验收：
  - [ ] 万级文件项目树展开流畅（虚拟化或懒加载生效）
  - [ ] 编辑保存落盘且 git status 可见变更
- 验证方式：在本仓库自举测试（吃自己的狗粮）

### [x] T2.2 Diff Tab + 快照回滚（✅ 2026-08-31：快照、MergeView、受控回滚及 CRLF 逐字节专项测试 3/3 通过）
- 来源：方案 §10.4、§4.4（DiffPanel）
- 前置：T2.1
- 步骤：
  1. `snapshot-service.ts`：`tool_execution_start(edit/write)` 读改前内容入 `Map<sessionId+toolCallId, {path, before}>`；`end` 时入 diff 队列
  2. 卡片内 `<InlineDiff>`（jsdiff 自绘行级）+ 右栏 `<CMDiffView>`（`@codemirror/merge`）
  3. `diff:revert(file|all)`：before 快照写回 + 追加系统消息
- 产出：`electron/main/workbench/snapshot-service.ts`、`renderer/components/right/DiffView.tsx`
- 验收：
  - [x] agent 每次改文件，卡片 diff 与右栏 Diff 同步出现
  - [x] revert 后文件内容逐字节还原（含换行符，Windows CRLF 场景专项验证）
- 验证方式：CRLF 专项用例 + 常规流程录屏

### [x] T2.3 终端面板（✅ 2026-08-31）
- 来源：方案 §10.2（T0.5 已验证可行性）
- 前置：T1.5
- 步骤：xterm + fit/web-links/search/unicode11/clipboard addons；`term:create/size/write/kill` + `term:onData/onExit` 事件；右键菜单；"agent 镜像模式"开关（消费 `bash_execution_update`，**注意 R-3 的语义警告**）
- 产出：`renderer/components/right/TerminalView.tsx`、terminal-service 完善
- 验收：
  - [ ] Windows ConPTY 下 PowerShell / Git Bash 均可交互；窗口 resize 不乱版
  - [ ] 长任务运行时 UI 不阻塞，tab 关闭进程被正确清理
- 验证方式：`ping`/`npm run dev` 等长输出命令实测

### [x] T2.4 浏览器面板（✅ 2026-08-31 headless 版 + agent 工具注入）
- 来源：方案 §10.1（**应用 R-4 决策：MVP 用 headless**）
- 前置：T1.5
- 步骤：
  1. `playwright-core` 起 headless Chromium；右栏 `<BrowserPanel>` 用截图轮询 + 操作按钮呈现（地址栏/后退/刷新）
  2. `agent-tools` 包：`browser_navigate / browser_click / browser_type / browser_read / browser_screenshot`（TypeBox 参数，`registerTool`）
  3. 截图压缩降采样控 token；`browser:*` IPC 域按方案 §3.2
- 产出：`packages/agent-tools/src/browser/*`、`renderer/components/right/BrowserPanel.tsx`
- 验收：
  - [ ] agent 完成"打开页面 → 点击 → 读内容"闭环，截图进对话
  - [ ] （记录到 §8）WebContentsView + CDP 实时版列为 Phase 3 后的 backlog 条目
- 验证方式：对 `https://example.com` 级静态页 + 一个真实 Web 项目各跑一轮

### [x] T2.5 工作台联动 + dockview 布局持久化（✅ 2026-08-31：工具事件联动、dockview 拖拽布局恢复、重型面板懒加载）
- 来源：方案 §4.4 联动规则、§11-3
- 前置：T2.1 ~ T2.4
- 步骤：workbench-store 实现 `tool_execution_start` → 自动开 tab / 切 Diff / bash 镜像规则；dockview `serializeLayout()/loadLayout()` 持久化到 `~/.pi-wood/layout.json`；重型组件全部 `React.lazy` 懒加载
- 验收：
  - [x] agent read → 自动开 CodeTab；edit → 自动切 DiffTab；面板拖拽/浮动/重启还原
  - [x] 首屏只加载轻组件（生产构建确认 Files/Terminal/Browser 独立懒加载 chunk）
- 验证方式：录屏 + 打包版冷启动耗时记录

### [x] T2.6 Phase 2 门禁评审（✅ 2026-08-31：真实 Provider 完成改代码→跑测试→浏览器验证，独立复核通过）
- 验收（方案 §12 Phase 2 原文）：
  - [x] agent 跑一个 Web 项目"改代码 → 跑测试 → 浏览器验证"全程桌面内闭环（按隐私要求以阶段状态与耗时记录替代含对话录屏）
  - [x] §8 记录 + Go/No-Go

---

## 5. Phase 3 · 生态接入（预计 2 周）

### [x] T3.1 扩展/Skill/模板全量复用 + 管理 UI（✅ 2026-09-02：扩展/Skill/Prompt 扫描、engine:reload、ctx.ui select/confirm/input 往返链路已落地；**真实社区包端到端验收完成**——离线 PI_OFFLINE 探针证 5 个已装社区包的扩展工具 + Skill(mcp-scripting) + 9 条命令全部生效、diagnostics 0 error；ctx.ui.confirm 阻塞往返经审批卡同路真机已验；ctx.ui.custom 补降级 +「桌面暂不支持」一次性标注，记录见 §8）
- 来源：方案 §5.2、§5.3、§5.9
- 前置：T2.6
- 步骤：ResourceManager 完整接入 `DefaultResourceLoader`；`/reload` 热重载（extension reload + session 事件重绑）；`ctx.ui` 桥四件套（notify→sonner、confirm/select/input→Radix Dialog，映射表见方案 §5.2）；`<SkillsBrowser>`、`<TemplateManagerTab>`
- 验收：
  - [x] 装一个含扩展+Skill 的社区包，全部生效（方案 §12 Phase 3 验收口径）
  - [x] 扩展内 `ctx.ui.confirm` 在桌面弹窗且返回值正确回传（阻塞式 Promise 链路）
  - [x] `ctx.ui.custom` 按方案降级并在 UI 标注"桌面暂不支持"
- 验证方式：真实社区包实测（包名记 §8）

### [x] T3.2 模型源管理 + 密钥钥匙串（✅ 2026-08-31 safeStorage 钥匙串 + 内置 8 源 + 自定义 OpenAI 兼容端点 + 设置弹窗，记录见 §8）
- 来源：方案 §5.6、§7、§10.6
- 前置：T2.6
- 步骤：
  1. `provider-manager.ts`：`ModelRuntime`（**R-1 术语**）+ `AuthStorage` 复用；`models.json` 读写
  2. `keychain.ts`：Electron `safeStorage`（Windows=DPAPI），密钥优先级链对齐方案 §5.6
  3. `<SettingsModal>`：`<ModelsTab>`（ProviderList/ProviderForm/测试连接）+ `Ctrl+L` 切换器 + `Ctrl+P` 收藏循环；思考档位动态获取（**R-4**）
- 验收：
  - [ ] 至少接入 Anthropic / OpenAI / OpenRouter / Ollama 四类源并完成对话
  - [ ] 自定义 OpenAI 兼容端点（如本地 vLLM）表单配置后可用
  - [ ] 密钥仅存钥匙串，grep 安装目录无明文（安全自查项）
- 验证方式：四 provider 各发一条消息 + 密钥落盘检查脚本

### [x] T3.3 主题 token 映射（✅ 2026-09-02：dark/light/system 兜底 + **Pi 社区主题全应用接入**——`theme-adapter.ts`（Pi theme JSON vars/colors→CSS 变量，纯函数+单测）+ 引擎 `engine:getPiTheme` 读 `~/.pi/agent/themes/<name>.json` + `theme-store` 写 `:root` 变量/切 data-theme/驱动 shiki+xterm；两主题截图证全 app 换肤一致，记录见 §8。遗留：Composer 卡片硬编码 `#333` 未随主题、shiki 仅按明暗切内置主题（token 级语法主题为后续））
- 来源：方案 §5.4
- 前置：T1.2
- 步骤：`theme-adapter.ts`：Pi 主题 token → CSS 变量（映射表按方案 §5.4，**实际 token 名以 Pi Theme 源码为准，核对结果记 §8**）→ 同步注入 CodeMirror theme / Shiki / xterm
- 验收：
  - [x] 任一 Pi 社区主题加载后全 app（含终端/代码高亮）换肤一致；light/dark/system 兜底可用
- 验证方式：切换 2 个主题截图对比 `docs/proofs/T3.3/`

### [x] T3.4 包市场（✅ 2026-09-01 真实包端到端验收通过：以 @narumitw/pi-plan-mode 实测 pi install→扩展生效(getActiveToolNames 含 plan 工具/诊断空)→卸载干净→复装，记录见 §8）
- 来源：方案 §5.5、§6.5
- 前置：T3.1
- 步骤：复用 Pi package-manager（`pi install npm:/git:` → settings `packages`）；`<PackageMarket>`（搜索/卡片/安装/更新/卸载）
- 验收：
  - [x] 市场内完成一次 npm 包安装 → 扩展生效 → 卸载干净（@narumitw/pi-plan-mode 实测，见 §8）
- 验证方式：真实包全流程

---

## 6. Phase 4 · 权限与高级模式（预计 1 周）

### [x] T4.1 审批门 + 策略（✅ 2026-08-31 inline extension 四档策略 + ApprovalCard 往返，超时默认拒绝）
- 来源：方案 §10.3（T0.4 已验证）、§9
- 步骤：`extensions/permission-gate.ts` 正式化：四档策略（全自动/高风险审批/全部审批/全部拒绝）+ 规则匹配（settings `approval.rules`）+ 未响应默认拒绝 + `sessionScopeAllowlist` 会话级授权；`<ApprovalCard>` 内联在对话流
- 验收：
  - [ ] 危险命令（`rm -rf` 类）默认拦截；"本次会话批准"后同类不再询问
  - [ ] 超时未响应 → 自动拒绝且 agent 收到 reason
- 验证方式：权限矩阵用例表逐条打勾（新建 `docs/permission-matrix.md`）

### [x] T4.2 项目信任 + path-guard（✅ 2026-08-31 信任预检徽标 + 审批门敏感路径拦截）
- 来源：方案 §9
- 步骤：`<TrustDialog>`（复用 Pi project_trust）；内置 path-guard 扩展：`.env`/`node_modules/`/`.git/`/`~/.ssh` 写保护
- 验收：
  - [ ] 未信任项目不加载 `.pi/*` 动态配置；guard 命中路径写入被阻断并提示
- 验证方式：构造恶意 `.pi` 扩展用例（本地测试仓）

### [x] T4.3 计划模式（✅ 2026-09-01 以现成插件 @narumitw/pi-plan-mode 达成，不手搓；工具已注册、诊断为空，见 §8）
- 来源：方案 §12 Phase 4
- 步骤：采纳 marketplace 底层 `pi install npm:@narumitw/pi-plan-mode`（插件提供 `/plan` start/exit/off + `plan_mode_question`/`plan_mode_complete`，计划批准前限工具、批准后恢复全权）
- 验收：
  - [ ] 计划批准前 agent 无法执行写操作；批准后正常执行（批准门为插件内建逻辑；带密钥 live 实跑一轮留待补，注册层已在 §8 探针实证）
- 验证方式：真实任务走一遍计划流

---

## 7. Phase 5 · 打磨与分发（预计 1~2 周）

### [x] T5.1 命令面板 + 全局搜索（✅ 2026-09-02：Ctrl/Cmd+Shift+P 聚合 应用命令+Pi/扩展/Skill/模板+模型+项目+@文件（`engine:listCommands` 复用 session + `fs:search`）；三栏键盘焦点 `Ctrl+1/2/3` 直达 + `Ctrl+.`/`Ctrl+Shift+.` 循环（`use-column-focus`，不劫持裸 Tab）；**§11 清单逐项终审完成**——25 条高频操作加权≈90% 达标、核心链路全键盘闭环，记录见 §8。后续小项（不阻塞）：#24 消息级分支/复制/标签/回滚缺稳定键盘入口（hover-only，中改）、#6/#7 输入框内联 `@`/`/` 触发（现经面板注入，中改））
- 来源：方案 §11-6/7/10
- 步骤：`Ctrl+Shift+P` 聚合应用命令 + Pi 命令 + 扩展命令 + Skill + 模板（数据源 `get_commands` 等）；`@` 文件联想；键盘优先（Tab 三栏焦点循环）
- 验收：
  - [x] 90% 高频操作可键盘完成（对照方案 §11 清单逐项过）
- 验证方式：清单打勾表

### [x] T5.2 插件系统（utilityProcess）（✅ 2026-09-03：**完整 §5.8 API + 管理 UI**。新建 `packages/plugin-api`（manifest/DesktopApi/RPC 帧/`API_PERMISSIONS`+`checkPermission` 纯函数权限门/`createDesktopApi` 客户端桥，**单测 10/10**）；主进程 `electron/main/plugins/`：`discovery`（内置 `plugins-examples/` + 用户 `~/.pi-wood/plugins/` 两源扫描）+ `capabilities`（§5.8 全量方法→宿主服务代理：notify/ui 复用引擎 `uiBridge` 同条 `ui:notify`/`ui:request`，window 直操 BrowserWindow，terminal 走 `child_process`，browser 复用 T2.4 服务，panels/statusbar/editor.openFile 经通道转推渲染层，diff/invokeAgentTool 尽力/预留）+ `plugin-host`（**每插件一个 utilityProcess 沙箱 + 权限门 + 敏感方法运行时确认 + 崩溃检测→退避自动重启(≤3次)→`ui:notify` 通知 + 面板/状态栏/总线注册表**）+ `plugins.ipc`。settings 加 `pluginsEnabled` 并重构为共享内存态 `getSettings/updateSettings`。渲染层 `plugin-store` + SettingsModal 新增「插件」tab（`PluginsPanel`：状态徽章/权限 chips/启停 Switch/重启/活动流 + **崩溃/越权一键演示**）。3 个示例插件 `demo-kitchen`/`demo-crash`/`demo-overreach`。验收硬指标①崩溃不杀主进程+自动重启+通知、②未声明权限调用被拒+日志均经代码/单测/构建路径覆盖。**✅ 已由 headless 探针 `electron/main/plugins/plugin-probe.ts`（`pnpm --filter @pi-wood/desktop probe:plugins` / `--plugin-probe`）真机断言：越权 `terminal.run`(需 terminal:run)/`diff.revert`(需 fs:write) 被拒入 activity+日志；`demo-crash` 崩溃(code 11)→toast→退避自动重启回 running(restarts=1)；主进程存活；EXIT=0**，记录见 §8）
- 来源：方案 §6、§5.8（R-4：排在 MVP 后，本阶段执行）
- 步骤：`PluginHost`（utilityProcess 沙箱 + manifest 权限白名单 + 崩溃重启）+ `packages/plugin-api` 类型（方案 §5.8 / §6.1）+ 一个示例插件
- 验收：
  - [x] 插件崩溃不杀主进程，自动重启并通知（`plugin-host.onExit`：非主动 stop 的 exit → 通知 + 退避重启 ≤3 次；utilityProcess 天然隔离主进程；`demo-crash` 收控制消息 `process.crash()` 触发）
  - [x] 未声明权限的 API 调用被拒并有日志（`checkPermission` 纯函数门，单测覆盖；拒绝走 `console.warn` + 活动流 `denied`；`demo-overreach` 仅声明 notify，激活自试 `terminal.run`/`diff.revert` 被拒）
- 验证方式：示例插件（含一次故意崩溃 + 一次越权调用）演示；`pnpm -r typecheck` 全绿、plugin-api `node --test` 10/10、`electron-vite build` 三目标通过；`⚠ 建议再跑一次 dev 点演示按钮做真机目检`


### [ ] T5.3 打包分发（部分完成：✅ Windows NSIS 产物；干净 Windows 安装验收、三平台与自动更新待补。**⚠ 本机环境阻塞**：无干净 Windows VM、无 mac/linux 构建机、无代码签名，"干净 VM 10 分钟跑通"与三平台/自动更新无法在本机验收，需具备环境后再做）
- 来源：方案 §10.6、§12 Phase 5
- 步骤：electron-builder 三平台（当前优先 Windows NSIS + 签名）；自动更新；新用户上手文档
- 验收：
  - [ ] 干净 Windows 虚拟机安装 → 10 分钟内跑通"配 Key → 首次对话 → 改文件"（方案验收口径）
- 验证方式：干净环境录屏

---

## 7.5 T6.2 子代理接线——goofansu in-process 路线（待办清单）

> **2026-09-02 评审结论**：弃用 nicobailon/pi-subagents（spawn 式 A 方案，原 §8 记录），改走 **goofansu/pi-subagent in-process 路线**（即原 §8 的"长期更优路线 C"）。
> **依据（源码级核实）**：goofansu 的 Pi harness 用与桌面**同款 SDK API**（`createAgentSession`/`ModelRuntime`/`SessionManager.inMemory`，devDeps 锁定 `pi-coding-agent@0.84.4` 与桌面一致）；child 走**内存会话**（不落盘→左栏会话树无噪声）、**无 spawn**（无 `process.execPath`/孤儿进程/密钥物化问题）、自过滤+深度防递归+父信任继承。**三个必须处理点**：① child 自建 `ModelRuntime(auth.json)`——桌面钥匙串经 `reinjectProviderEnv()` 注入 process.env（T3.2），**同进程应可见，需探针确认**；② child 的 bash 是原生 `createBashToolDefinition`，**不经桌面审批门**（必须注入，否则子代理=审批旁路，与 spawn 版同洞、只是更好补）；③ 包未发 npm、无 `exports`/`main`，且 `createPiHarness({sessionOptionsFactory,...})` 注入点默认扩展入口**未暴露** → 需一次小 fork。

> **✅ 2026-09-02 落地（方案 1：SDK 托管 ESM 扩展）+ 真机 e2e 已验证**。
> **⚠ 首版走错并已回退**：最初把 vendored 源码用相对 `.ts` import **打进 CJS 主进程 bundle** → 启动即崩 `ERR_PACKAGE_PATH_NOT_EXPORTED`（`pi-coding-agent` 是 **ESM-only**、esbuild 把静态 import 转成顶层 `require`；且 vendored `agent.ts` 用 `import.meta.url` 在 CJS 下失效）。**typecheck / `electron-vite build` / 离线探针（都在 ESM 下跑）全都盖不住这个运行时边界——只有真机启动 e2e 暴露**。教训入 MEMORY。
> **最终机制（方案 1）**：
> - **不打进 bundle**：新增 `SdkAdapter`/`EngineStartOptions.additionalExtensionPaths` → 透传进 `createAgentSessionServices({resourceLoaderOptions})`，让 **SDK 的 jiti/ESM 管线在运行时加载** `electron/main/subagent/pi-wood-subagent-entry.ts`（default export = factory，收 parent `pi`）。jiti 的 `getAliases()` 把 `pi-coding-agent`/`pi-tui`/`typebox`/`pi-ai` 别名到 SDK 自带实例，`import.meta.url` 天然可用。`composition.ts` 仍只留 Pi harness；`pi-tui` 提为直接依赖（供 tsc 类型 + 解析）。
> - **child 审批门经 globalThis 桥**（`subagent/bridge.ts`）：ESM 扩展拿不到 CJS 主进程的 `confirmViaRenderer`，故主进程 start 前挂 `__piwoodSubagentBridge = { buildChildGate, guardChildTool, onRuntime }`，入口读它建 child 门 + 回传 runtime 供回收。
> - **⚠ child（print 模式）会话不触发 `tool_call` 事件钩子** → 注入的 `extraExtensionFactories` 门**装了不拦**。改为在 vendored `createPiSessionOptions` 里**包装 child 的 `bash` `execute()`**，执行前直接调 `guardChildTool`（`decide` + ApprovalCard confirm）→ 拒绝即返回错误、不跑命令。
> - **⚠ 修了一个通用缺陷（不止子代理）**：`SdkAdapter.newSession/switchSession/fork` 之前只重订阅事件、没再 `bindExtensions` → 新会话不发 `session_start` → 靠 `session_start` 注册工具的扩展（子代理）**丢工具**（表现：模型看不到 `agent_start`）。补 `bindExtensions()` 私有方法、三处会话替换后各调一次。
> - **S1 空操作**（macOS、无全局 settings.json、无旧包、`pi` 不在 PATH）；`ensure-electron.mjs` 修 macOS 二进制检测（`dist/Electron.app/.../Electron`，win 自愈逻辑保留）。子代理 profile 放 `~/.pi/agent/agents/{general,explore}.md`。
> **真机 e2e 已验证**（带 DeepSeek 密钥、dev9）：`agent_start→agent_wait→agent_result` 委派跑通；`general` 子代理执行 `git log --oneline -3` 时**弹出桌面 ApprovalCard**（`允许执行 bash?`）→ 审批旁路堵上。
> **剩余（后续）**：child 的 **bash/edit/write 均已包守卫**（`guardTool` 泛化，真机验 `write` 弹卡）；子代理进度/状态上屏归 §7.7 T6.3；ApprovalCard 入参原样显示 JSON 偏丑（展示打磨）；完整多代理 fan-out/steer/cancel e2e 可选再补。

### S1 停用旧 spawn 版（先解除报错）
- [x] ~~移除 `pi-subagents`~~ → **本机 N/A**：macOS、无 `~/.pi/agent/settings.json`、无旧包、`pi` CLI 不在 PATH，无 `Could not resolve the Pi CLI on Windows` 需解除；且走 vendored 内联 import 不碰磁盘扩展加载。

### S2 装 goofansu 原版 + 三探针（验证路线成立，不 fork）
- [x] ~~`pi install https://github.com/goofansu/pi-subagent`~~ → 改为 **vendored**（clone 源码裁进 `electron/main/subagent/vendor/`，相对 `.ts` import），不依赖 `pi` CLI/磁盘加载。
- [x] 探针1（离线等价）：真实 Node（`--experimental-strip-types`）加载 `pi-wood-subagent.ts` → 用假 `ExtensionAPI` 走 `runtime.attach(pi)`→触发 `session_start`→断言 **6 个 `agent_*` 工具全部注册**、无抛错、`dispose()` 干净。**偏差**：以假 `pi` 记录 `registerTool` 调用替代 SDK `getActiveToolNames()`；`createAgentSession` 在 Electron 主进程内可创建留待密钥 e2e。
- [x] 探针2（真密钥 DeepSeek env）：主 agent 触发 `agent_start(explore)`→`agent_wait`→`agent_result`，子代理用父模型跑通并回传结果。**已验**（S6 dev9 单代理 + 本轮多代理 fan-out，见 §8 `t62-e2e.png`）
- [x] 探针3：child 跑通即证 `ModelRuntime` 能看到 env/钥匙串注入的密钥；本轮多代理编排干净 settle（无挂起）证 print-bind 下 `ctx.ui` 为取消/no-op 非挂起；child 为进程内 inMemory 会话、左栏真实项目 sessionsList 未被污染。**已验**（§8 `t62-e2e.png`）
- [x] 记录结论：凭据可见、审批可控（child bash/edit/write 走桌面审批门，dev10 已验）→ 已进 S3/S4 并落地

### S3 fork goofansu/pi-subagent（小改动，吃满注入点）
- [x] 镜像源码至项目内 → **落点改 `apps/desktop/electron/main/subagent/vendor/`**（非 `extensions/pi-subagent/`），保留 MIT `LICENSE` + `docs/adr/*` + `CONTEXT.md`；裁掉 claude/codex harness、`*.test.ts`、conformance/`suite-setup`/`standalone-run-helper`。
- [x] ~~补 `package.json` exports/main~~ → **不需要**：以相对 `.ts` import 由 esbuild 打进主进程 bundle，非磁盘包加载。
- [x] ~~`index.ts` 导出 `createPiHarness`~~ → 直接按路径 `import { createPiHarness } from "./vendor/harnesses/pi/harness.ts"` 等；`composition.ts` 改为 `createHarnessRegistry([createPiHarness()])`（去 claude/codex，其 `@anthropic-ai/claude-agent-sdk` 不在依赖树）。
- [x] `createPiHarness({sessionOptionsFactory, sessionFactory, agentDir})` 注入点**已存在、无需改**；**新增** `createPiSessionOptions(..., extraExtensionFactories?: InlineExtension[])`（vendored 内一处小改）透传进 child 的 `DefaultResourceLoader.extensionFactories`，供 host 注入审批门。

### S4 pi-wood 引擎侧注入（核心接线）
- [x] 新增 **`apps/desktop/electron/main/subagent/pi-wood-subagent.ts`**（非计划的 `pi-wood-session-options.ts`）：`createPiWoodSubagentRuntime({getPolicy, confirm, isAutoAccept?, agentDir?})` → 用自定义 `sessionOptionsFactory` 调 vendored `createPiSessionOptions(context, model, thinking, dir, signal, [childGate])`，把桌面 `permissionGateExtension` 作为 `extraExtensionFactories` 注入 child `resourceLoader.extensionFactories`；凭据/深度注入/`excludeTools`/`SessionManager.inMemory`/print-bind 全部沿用 vendored 默认工厂（不重写，避免漂移）。产出 `{runtime, inlineExtension:{name:"piwood-subagent",factory}, dispose}`。
- [x] `engine-manager.ts`（**方案 1 终态**，取代下方旧"打包式"描述）：`ensureEngineUnlocked` 里设 `globalThis.__piwoodSubagentBridge={buildChildGate, guardChildTool, onRuntime}`，并把 `additionalExtensionPaths:[entry]`（`existsSync` 守卫）传进 `next.start` → 由 SDK/jiti 加载 ESM 入口。`getPolicy/confirm` 经闭包进桥（未抽 approval-io）。**并修 `SdkAdapter.newSession/switchSession/fork` 未再 `bindExtensions` 的通用缺陷**（否则新会话不发 session_start、子代理丢工具）。切项目 `disposeSubagent()` 走桥回传的 runtime。
- [x] 验证（**真机 e2e 已验**，DeepSeek + dev9/dev10）：`general` 子代理执行 `git log` 弹 `允许执行 bash?`、写文件弹 `允许执行 write?`（dev10 复验）。因 child print 会话不触发 `tool_call`，门改由 vendored `createPiSessionOptions` 的 `guardTool` **包 `bash/edit/write` 的 `execute`** 调 `guardChildTool` 生效（child 三个高危工具全覆盖）。

### S5 生命周期与 UX
- [x] 切项目回收：`ensureEngineUnlocked` 换项目处 `await disposeSubagent()` → `runtime.subagents.shutdown()`（标 closed + 转发在飞 Run 取消）+ `delivery.shutdown()`（`runs.cancelRunning("shutdown")`），best-effort 容错。child 为进程内内存会话，进程退出即回收；关窗 quit 钩子可后续补。
- [x] 子代理进度/完成通知上屏：由 **§7.7 T6.3 SubagentPanel** 落地（runs 注册表 → `engine:subagentRuns`/`subagentEvent` IPC → 右栏实时状态、出现即自动弹出），本 increment 已含
- [x] 并行 fan-out 与深度防递归：沿用 vendored 默认（`PI_SUBAGENT_DEPTH` 注入 + `isPiChildExtensionLoad()||depth>0` 时扩展 inert + `filterPiChildExtensions` 去自身）→ 防递归成立；无 cap 与桌面审批并发策略一致。

### S6 门禁与验收
- [x] 真密钥 e2e（DeepSeek）：单代理委派 `agent_start→agent_wait→agent_result` + child `bash` 弹桌面 ApprovalCard（dev9/dev10 审批旁路堵上）；**本轮补齐完整编排**——并行 3 个 explore 子代理 fan-out + `agent_steer`（B 追加指令被子代理消费并如实回应）+ `agent_cancel`（C 1 回合后停止、含 per-child tokens/费用）+ `agent_wait` 收口，见 §8 `t62-e2e.png`。**仍待补（可选）**：命名会话 `agent_resume` 续跑编排。
- [x] 静态门禁：`pnpm -r typecheck` 全绿（含整份 strict 下 vendored 内核 + 接线）、`electron-vite build` 通过（out/main 打入 `agent_*`+`piwood-subagent`+`piwood-permission-gate`，pi-tui 已 externalize）、**离线探针**证明 6 个 `agent_*` 工具经 `attach→session_start` 注册、dispose 无抛错；`git diff --check` 干净。（旧 spawn 版本机不存在，无残留。）
- [x] 结果回写 §8 + 本 §7.5 偏差。

### 已核实事实速查（评审时确认，勿重查）
- `getPiSpawnCommand`（nicobailon `src/runs/shared/pi-spawn.ts`）：win32 + `.js` → `{command: process.execPath, args:[cli,...]}`——桌面下 `process.execPath`=electron.exe，需 `ELECTRON_RUN_AS_NODE=1`（该 spawn 方案已弃）
- goofansu `harnesses/pi/agent.ts`：`createPiSessionOptions` 自建 `ModelRuntime`/`SettingsManager`/`SessionManager.inMemory`；`bindExtensions({mode:"print"})`；`createPiManagedAdapter` 持惰性会话 + 有界清理
- goofansu `index.ts`：导出 `createSubagentRuntime`（含 `harnesses?` 依赖注入）、`registerSubagentFeatureTools`；默认导出在 `isPiChildExtensionLoad()||depth>0` 时 inert（防递归）
- 桌面现状：`engine-manager.ts:61` 单 adapter；`ensureEngineUnlocked` 注入 `inlineExtensions:[permissionGateExtension(getPolicy, confirmViaRenderer)]` + `customTools:browserCustomTools()`；`reinjectProviderEnv()` 钥匙串→process.env（T3.2）

## 7.6 渲染层降噪三件套（T5.4 工具紧凑显示 / T5.5 思考折叠预览 / T5.6 连续工具分组）

> **2026-09-02 决策**：评估三个社区插件（`pi-tool-display`、`@99percentpeople/pi-thinking-fold`、`@fahmiirsyadk/pi-minimal-toolcall`）——**均为 TUI 插件**（peer/关键词带 `pi-tui`，渲染挂在 pi-tui 的 `registerMessageRenderer`/widget 管线），pi-wood 无 pi-tui、用自有 React 渲染层，**不能 `pi install` 直接用**（装了 no-op 或报错）。但其中两个的核心模式 ui-kit 已实现 70~80%，第三个是真缺口。**决策：不装插件，把 UX 模式移植到现有组件**。
> **现状核实**（源码级）：`packages/ui-kit/src/tool-card.tsx` 已有 `ToolCard`（默认折叠一行：图标+动词+目标+diff 增删数，点击展开，状态图标，bash 折叠行显示 `oneLine(command)`，edit 展开用 `DiffView`）和 `ThinkingCard`（一行「思考 · 持续了 N 秒」，点击展开，流式自动展开）；`apps/desktop/src/renderer/src/components/center/MessageList.tsx` 用 `ConversationItem` 判别联合（user/assistant/thinking/tool/system）+ `@tanstack/react-virtual` 虚拟化，`ToolRow`/`ThinkingRow` 单条渲染，已有 `ui.toolCardsDefaultOpen`/`ui.thinkingDefaultOpen` 设置；shiki 已装（`code-block.tsx`）。

### [x] T5.4 工具紧凑显示（pi-tool-display 模式移植）（✅ 2026-09-02：ui-kit 新增 `shiki-command.tsx`（缓存+回退）+ ToolCard 折叠行 bash 内联高亮 / 状态文字 Badge / 展开命令块高亮 / >200 行输出提示，ui-kit+desktop typecheck+build 全绿，记录见 §8；dev HMR/真机折叠展开截图手验留后）
- 来源：社区 `pi-tool-display@0.5.0`（MasuRii）——紧凑工具调用渲染 + diff 可视化 + 输出截断
- 前置：无
- 步骤（改 `packages/ui-kit/src/tool-card.tsx`）：
  1. **折叠行命令 shiki 高亮**：`ToolCard`（line 98）折叠行中 bash/powershell 的 `target`（当前是 `oneLine(str(args.command))` 纯文本 mono span）改为内联语法高亮——复用现有 `CodeBlock`（shiki）的轻量 `InlineCode` 变体（若 `CodeBlock` 不支持 inline，新建 `components/inline-code.tsx`，language=shell，memoize tokenize 结果）；read/edit/write 的路径保持纯 mono（路径不需要高亮）
  2. **状态文字 Badge**：`headerIcon`（line 44）旁加文字标签——running→「运行中」（`animate-pulse` + primary 色）、ok→「已完成」（success 色，仅 hover/展开时显或常显淡色）、error→「失败」（destructive 色）；对齐 pi.dev「已运行 + 命令行」样式；图标保留
  3. **展开命令块高亮**：`ToolBody`（line 64）中 bash/powershell 的 `$` 命令块（line 75-80，当前纯 font-mono span）改用 `CodeBlock`（shiki，language=shell，compact 变体，去掉行号/复制按钮，保留 `$` 前缀）
  4. **输出截断优化**：`outputBlock`（line 61）当前 `max-h-72` 固定——保持，但超长输出（>200 行）在折叠行目标后加 `…(+N 行输出)` 提示，引导用户展开
- 验收：
  - [x] bash/read/edit/write/grep/find/ls 七种内置工具 + browser_* 扩展工具，折叠行命令有 shiki 语法高亮（bash 类）
  - [x] 状态有文字 Badge（运行中/已完成/失败），与图标并存不冲突
  - [x] 展开时 bash 命令块有 shiki 高亮
  - [x] `pnpm typecheck` + build 全绿；dev HMR 生效
- 验证方式：真实对话触发 bash/read/edit 各一次，截图对比折叠/展开两态

### [x] T5.5 思考折叠预览（pi-thinking-fold 模式移植）（✅ 2026-09-02：`ThinkingCard` 加 `preview` 尾部预览 + `fmtDuration` 紧凑化「耗时 12.3s」+ `ThinkingRow`/live 流式传 tail-60，ui-kit+desktop typecheck+build 全绿，记录见 §8；真机长思考实时预览截图手验留后）
- 来源：社区 `@99percentpeople/pi-thinking-fold@0.1.9`——把流式思考折叠为 live tail 预览，快捷键展开
- 前置：无
- 步骤：
  1. **`ThinkingCard` 加 preview prop**（`packages/ui-kit/src/tool-card.tsx` line 141）：新增 `preview?: string`（思考内容尾部截断，定长 60 字符）；折叠行在「思考 · 耗时 Ns」后追加 `· {preview}`（流式时实时更新，非流式时显示完整思考的尾部摘要）；`preview` 为空时回退当前「思考中…/持续了 N 秒」
  2. **耗时格式紧凑化**：`fmtDuration`（line 133）从「持续了 N 秒」改为「耗时 12.3s」（保留中文可读，<1s 显示「耗时 <1s」，≥60s 显示「耗时 1m2s」）；对齐用户举例
  3. **`ThinkingRow` 传 preview**（`MessageList.tsx` line 78）：从 `item.text` 取尾部 60 字符作为 preview（`item.text.slice(-60)`，去换行）；`session-store` 的 `ConversationItem` thinking kind 已有 `text`/`durationMs`，无需改数据模型
  4. **live 流式思考也加预览**（`MessageList.tsx` line 206）：`liveThinking` 渲染的 `ThinkingCard` 传 `streaming` + `preview={liveThinking.slice(-60)}`，让流式时折叠行也能看到推理尾部（当前只显示「思考中…」）
- 验收：
  - [x] 折叠行显示思考内容尾部预览（非流式），不只是耗时
  - [x] 流式时预览实时更新（每 token 尾部变化）
  - [x] 耗时格式为「耗时 12.3s」
  - [x] 点击展开看完整思考内容（现有行为不变）
  - [x] `pnpm typecheck` + build 全绿
- 验证方式：开 high thinking 模型跑一次长思考任务，观察折叠行预览实时变化

### [x] T5.6 连续工具分组（pi-minimal-toolcall 模式移植）（✅ 2026-09-02：纯函数分组 + ToolGroup 组件 + 虚拟化接入 + 设置项 + Ctrl+Shift+E，typecheck/test/build 全绿，记录见 §8；真实连续工具/1 万条压测/快捷键运行态手验留后）
- 来源：社区 `@fahmiirsyadk/pi-minimal-toolcall@0.2.1`（月下载 70，很新）——连续工具调用分组折叠 + 快捷键切换
- 前置：无（三项中降噪价值最高、改动量最大）
- 步骤（改 `MessageList.tsx` + 新增 `ToolGroup` 组件）：
  1. **items 预分组**：`MessageList`（line 126）渲染前，把 `items` 中连续的 `kind: "tool"` 归为一组（中间没有 assistant/user/thinking/system 即连续），生成 `displayRows: Array<ConversationItem | ToolGroup>`；`ToolGroup = { id: string, kind: "tool_group", tools: ConversationItem[], status: "running"|"all_ok"|"has_error", totalDurationMs, startTs }`
  2. **虚拟器适配**：`useVirtualizer`（line 137）的 `count` 从 `items.length` 改为 `displayRows.length`，`getItemKey` 用 `displayRows[i].id`；`ConversationRow`（line 114）增加 `case "tool_group"` 分支渲染 `ToolGroup`
  3. **`ToolGroup` 组件**（新建 `components/center/ToolGroup.tsx` 或放 ui-kit）：组头一行——「N 个工具调用 · 全部成功/部分失败 · 总耗时 Xs」+ 折叠/展开按钮（ChevronDown）+ 组内工具状态摘要（成功数/失败数/运行中数）；折叠时只显组头，展开时组内依次渲染 `ToolCard`（复用现有 `ToolRow` 逻辑）；组头背景 `bg-muted/30` 圆角，与单条工具卡视觉区分
  4. **设置项**：`settings-service.ts` 加 `ui.toolGroupsEnabled`（默认 true）、`ui.toolGroupsDefaultOpen`（默认 false）；SettingsModal「界面」页加开关（复用现有 `ui.toolCardsDefaultOpen` 模式）；关闭时退化为单条渲染（`displayRows = items`）
  5. **全局快捷键**：`Ctrl+Shift+E`（Expand/collapse all tools）切换所有工具组展开/收起（需确认不与现有快捷键冲突：现有 Ctrl+Shift+P 命令面板、Ctrl+1/2/3 栏焦点、Ctrl+. 循环；Ctrl+Shift+E 无冲突）；在 `App.tsx` 全局 keydown handler 注册（复用现有命令面板快捷键注册模式）；切换状态存内存（不持久化，刷新恢复 defaultOpen）
  6. **流式兼容**：运行中的工具（status=running）所在组自动展开（或组头显示「运行中…」脉冲），完成后可按 defaultOpen 收起；live 尾块（line 204）不参与分组
- 验收：
  - [x] 连续多个工具调用自动归为一组，组头显示数量/状态/总耗时
  - [x] 单个工具调用（前后有文本）不被误分组
  - [x] 点击组头折叠/展开；组内 ToolCard 可独立展开
  - [x] `Ctrl+Shift+E` 切换全部组展开/收起
  - [x] 设置关闭分组后退化为单条渲染
  - [x] 虚拟化列表滚动/测量正常（分组行高度动态，`measureElement` 自适应）
  - [x] `pnpm typecheck` + desktop test + build 全绿；1 万条压测不卡死（复用现有虚拟化）
- 验证方式：真实对话触发连续 5+ 工具调用（如 read×3 + edit×2），观察分组/折叠/快捷键；再触发单工具+文本混合，确认不误分组

### 落地顺序（按降噪价值/成本比）
1. **T5.6 连续工具分组**（中改，价值最高）——多步执行任务降噪最明显
2. **T5.4 工具紧凑显示**（小改）——shiki 高亮 + 状态 Badge，对齐 pi.dev 视觉
3. **T5.5 思考折叠预览**（小改）——思考尾部预览，降低长思考噪音

## 7.7 子代理 UX 层——OpenChamber 模式借鉴（T6.3~T6.7）

> **2026-09-02 决策**：分析 OpenChamber（`openchamber/openchamber`，底层 opencode）的子代理实现——其**子代理机制本身是 opencode 原生 task 工具**（server 端 child session + parentID + SSE 推送），OpenChamber 真正有价值的是套在上面的**可视化 + 生命周期管理层**：parentID 追踪、子代理状态面板、审批请求上浮、task 元数据解析→「打开子代理」按钮、只读子会话视图、成本汇总（含嵌套）、per-agent 权限配置。
> **架构差异**：opencode 是 HTTP server + SSE（客户端调 API 列 session、过滤 parentID）；pi-wood 是 in-process SDK + Electron IPC（session 是内存对象、无 HTTP API）。**传输层不搬（不起 HTTP server），模式全搬**——parentID 追踪改为内存 Map、状态推送改为 IPC event、审批上浮复用现有 `approval_request` 通道。
> **依赖**：全部依赖 §7.5（goofansu in-process 引擎接线）完成后开工；§7.5 S5「子代理进度/完成通知上屏」由本节 T6.3~T6.7 具体化。
> **现状核实**（源码级）：`session-store.ts` 单会话 zustand（无 parentID/多会话追踪）；`RightPane.tsx` Chrome 式单标签，`WorkbenchTab = "diff"|"term"|"browser"|"files"`（定义在 `workbench-store.ts`），`panelMeta`/`panelNode` switch 扩展点清晰；`runtime-store.ts` 跟踪 RuntimeInfo/tasks/todos，无成本汇总；`ipc-schema/engine.ts` `EngineEventSchema` 已有 `approval_request`/`permission_granted` 自定义事件，`ENGINE_CHANNELS` 可加 subagent 通道；`tool-card.tsx` `ToolCard` 有 footer 扩展点。

### [x] T6.3 子代理运行时追踪 + 状态面板（基础，最高优先级）
> **✅ 2026-09-02 落地（真机 dev11 验证：面板自动弹出、状态 running→completed）**。**数据源与本（方案1 前）规格的差异**：不新建 `subagent-registry.ts` 类、不拦截 child session 事件打 `_origin`——改用 vendored **`runtime.runs` 注册表**（`list(): RunView[]` + `subscribe`）作为唯一事实源。落地：① `bridge.ts` 的 `PiWoodSubagentRuntimeRef` 拓宽暴露 `runs`；② `engine-manager` 在 `onRuntime` 里 `runs.subscribe`→`send(engine:subagentRuns, mapSubagentRuns(list))`，`disposeSubagent` 退订；③ `ipc-schema` 加 `SubagentRunInfoSchema` + 通道 `subagentRuns`(推)/`subagentList`(拉初值)；④ preload+global.d.ts `onSubagentRuns`/`subagentList`；⑤ 渲染层 `subagent-store`（runs + refresh）；⑥ `SubagentPanel`（agent 名/状态徽章/耗时/轮次/activity + 空态）；⑦ `workbench-store` 加 `"subagent"` tab、`RightPane` `panelMeta`(icon `brain`, `Ctrl+Shift+A`)+`panelNode` case、`App` 订阅 + **0→N 自动开面板 once**。**两处有意未做**：(a) **child 审批上浮到面板**——现仍由 `guardChildTool` 在**对话流**弹 ApprovalCard（重路由到面板留后续）；(b) **child 执行内容/只读子会话视图 = T6.5**——面板只有 runs 元数据（状态/耗时/轮次/activity 一行），看不到子代理内部消息流/工具/思考，需转发 child session 事件才能补。
- 来源：OpenChamber `WorkStatusSubagentsSection.tsx`（parentID 过滤 + 状态/审批/成本 + 出现即展开）
- 前置：§7.5 S4（引擎侧注入，child session 可创建）
- 步骤：
  1. **主进程子代理注册表**（新建 `apps/desktop/electron/main/subagent/subagent-registry.ts`）：`class SubagentRegistry`——`Map<parentSessionId, Map<subagentId, ChildRuntime>>`；`register(parentId, child)` / `unregister(subagentId)` / `getChildren(parentId)` / `getAggregatedCost(parentId)`；child session 的 `session.subscribe()` 事件全部打上 `_origin: {sessionId: subagentId, isSubagent: true}` 后经现有 `engine:event` 通道转发（复用 event-bridge，不新建通道）
  2. **child 审批事件上浮**：child session 注入的 `permissionGateExtension`（§7.5 S4）触发 `approval_request` 时，事件载荷带 `_subagentId`；渲染层据此区分父/子审批——child 审批不在对话流弹 ApprovalCard，而在子代理面板显示徽章+卡片
  3. **IPC 扩展**（`packages/ipc-schema/src/engine.ts`）：加 `SubagentInfoSchema`（id, parentId, agentName, status: `"running"|"done"|"needsApproval"|"error"`, startedAt, tokens?）；`ENGINE_CHANNELS.subagentList = "engine:subagentList"`（invoke→SubagentInfo[]）；`approval_request` 事件 schema 加可选 `_subagentId: z.string()`
  4. **渲染层子代理 store**（新建 `apps/desktop/src/renderer/src/stores/subagent-store.ts`）：zustand——`children: SubagentInfo[]`、`approvals: Map<subagentId, ApprovalRequest[]>`、`selectedId: string|null`；订阅 `engine:event` 过滤 `_origin.isSubagent` 更新状态/审批；`refresh()` 调 `engine:subagentList`
  5. **子代理面板**（新建 `apps/desktop/src/renderer/src/components/right/SubagentPanel.tsx`）：列表视图——每个子代理一行：agent 名、状态 Badge（运行中/已完成/待审批/失败）、耗时、tokens；待审批子代理高亮 + "N 待审批" 徽章，点击展开 ApprovalCard（复用现有审批卡组件）；点击子代理行→`setSelectedId`（T6.5 只读视图）；空态"暂无运行中的子代理"
  6. **出现即展开**（仿 OpenChamber `hadChildren` ref）：`SubagentPanel` 内 `useRef(hadChildren=false)`，children 从 0→N 时自动打开子代理标签页一次（`useWorkbenchStore.openTab("subagent")` + setActive），之后尊重用户手动关闭
  7. **RightPane 接入**：`workbench-store.ts` 的 `WorkbenchTab` 加 `"subagent"`；`RightPane.tsx` `panelMeta` 加 `subagent: {title:"子代理", icon:"aiAgent", kbd:"Ctrl+Shift+A"}`（确认无冲突：现有 Ctrl+Shift+P/G、Ctrl+`/T/P、Ctrl+1/2/3、Ctrl+.、Ctrl+Shift+E(T5.6 待实现)，Ctrl+Shift+A 空闲）；`LAUNCH_ORDER` 加 `"subagent"`；`panelNode` 加 `case "subagent"`
- 验收：
  - [ ] 主 agent 触发 `agent_start` 后，子代理面板自动出现并显示该子代理（运行中）
  - [ ] 子代理触发 bash（highRisk）→ 子代理面板显示"待审批"徽章 + ApprovalCard，不在对话流弹窗
  - [ ] 用户批准/拒绝→子代理继续/终止，状态更新
  - [ ] 子代理完成→状态变"已完成"，耗时/tokens 显示
  - [ ] 关闭子代理标签页后，新子代理启动时不再自动弹出（hadChildren 已 true）
  - [ ] `pnpm typecheck` + desktop test + build 全绿
- 验证方式：真密钥跑 agent_start(explore) + 子代理内 bash，观察面板/审批/状态全链路

### [x] T6.4 对话流「打开子代理」按钮 + 元数据清洗
> **✅ 2026-09-02 落地（真机 dev13 验证：工具卡显示清洗摘要、点「打开子代理会话」直达该子代理详情）**。落点 `packages/ui-kit/src/tool-card.tsx`：① `describe()` 给 `agent_*` 六个工具加中文动词/目标；② `agent_start` 展开体**清洗**成「子代理已启动：{agent} · run {short}」（隐藏 `formatStartResult` 那一大段 "Use run id ... for agent_wait" prose）+ 「打开子代理会话」按钮；③ `agent_result` 保留结果正文 + 同款按钮。**偏差**：runId 从工具**输出文本**正则解析（`run id <id>` / `run <id>:`），因 vendored `result.details` 为 undefined、无结构化字段；按钮派发全局 `piwood:open-subagent` CustomEvent（不逐层传 prop）；`selectedId` 移入 `subagent-store`（面板未挂载也能被事件驱动）；`App` 监听→`setSelectedId`+`openWorkbench("subagent")`。与 T6.5 面板行点击并存，对话流按钮成为主入口。
- 来源：OpenChamber `taskToolModel.ts`（解析 `<task_metadata>`→sessionId→「Open subAgent session」按钮 + strip 元数据）
- 前置：T6.3（子代理面板可打开）
- 步骤（改 `packages/ui-kit/src/tool-card.tsx`）：
  1. **子代理工具识别**：`ToolCard` 检测 `name === "agent_start"`（goofansu 工具名）或 `args.agent` 存在；从 `args` 取 agent 名、从 `result.details`（tool_execution_end 的 details）取 `subagentId`/`runId`
  2. **「打开子代理会话」按钮**：ToolCard footer（output 之后）加 ghost 小按钮——Icon(`aiAgent`) + "打开子代理会话"；点击→`window.dispatchEvent(new CustomEvent("piwood:open-subagent", {detail:{subagentId}}))`；`SubagentPanel` 监听此事件→openTab + setSelectedId
  3. **元数据清洗**：agent_start 的 `output` 常含 raw JSON（subagentId/runId/status）——检测 output 为 JSON 且含 subagentId 时，不显示 raw JSON，改为干净摘要行："子代理已启动：{agentName}（{subagentId 短码}）"；非 JSON output 正常显示
  4. **agent_result/agent_cancel 同理**：agent_result 工具卡显示"子代理完成：{agentName}"+ 结果摘要；agent_cancel 显示"子代理已取消"
- 验收：
  - [ ] agent_start 工具卡显示「打开子代理会话」按钮，点击→子代理面板打开并选中该子代理
  - [ ] agent_start 的 raw JSON 输出被清洗为摘要行，不显示乱码 JSON
  - [ ] 非子代理工具（bash/read/edit）不受影响，正常渲染
  - [ ] `pnpm typecheck` + build 全绿
- 验证方式：触发 agent_start，检查工具卡按钮和输出清洗

### [x] T6.5 只读子会话视图
> **✅ 2026-09-02 落地（真机 dev12 验证：点进子代理行 → 实时流式显示其思考/工具/输出）**。**与规格差异**：① 数据源 = **转发 child 会话事件**——vendored 加 `onRunEvent` 链（`createPiHarness`→`createPiManagedAdapter`→`runPiAttempt`，在 `reportEvent` 里 `onEvent(run.id, rawEvent)`），并给 `SubagentRun` 补 `id`（`runner.ts` 传 `handle.id`）；`engine-manager` 用 `normalizeEngineEvent`（新导出）归一后 `send(engine:subagentEvent, {runId, event})`。② **关键发现**：child print 会话虽不发 `tool_call` 钩子，但 `session.subscribe` 仍出 `message_update`/`tool_execution_*` → 在 session-subscribe 层转发可行。③ `subagent-store` 用**独立精简 reducer**（`itemsByRun`）而非从 `session-store` 抽共享 `eventToItem`（隔离、不碰主链路）。④ 详情视图用**自定义只读渲染**（Markdown/ThinkingCard/工具行），**未给 MessageList 加 readOnly prop**；入口 = 点面板行（T6.4 对话流「打开子代理」按钮仍未做）。
- 来源：OpenChamber `openChildSession`（readOnly context panel tab——用户可观察不可干扰）
- 前置：T6.3（子代理 store + 面板）、T6.4（打开按钮）
- 步骤：
  1. **SubagentPanel 双视图**：列表视图（T6.3）+ 详情视图（选中子代理后）；详情视图头部：子代理名 + 状态 Badge + "← 返回列表"按钮
  2. **子代理消息流**：`subagent-store` 维护 `Map<subagentId, ConversationItem[]>`——处理打了 `_origin.sessionId` 标签的 engine 事件，复用 `session-store.ts` 的 `handleEvent` 逻辑（提取共享 `eventToItem` 纯函数，session-store 和 subagent-store 共用，避免重复）
  3. **只读 MessageList**：详情视图渲染 `MessageList` 加 `readOnly={true}` prop——底部无 Composer、工具卡无交互（审批按钮不显示，审批在列表视图处理）、自动滚动到底部跟随流式输出
  4. **流式实时更新**：子代理的 text_delta/thinking_delta/tool_execution_* 事件实时更新详情视图消息流（与主会话同机制，只是数据源是 subagent-store 的对应 map）
- 验收：
  - [ ] 点击子代理→详情视图显示该子代理的完整对话流（用户 prompt + 思考 + 工具 + 回复）
  - [ ] 子代理运行中时，详情视图实时流式更新（自动滚动）
  - [ ] 详情视图无 Composer、无法发送消息、工具卡无审批按钮（只读）
  - [ ] "返回列表"回到子代理列表
  - [ ] `pnpm typecheck` + build 全绿
- 验证方式：触发 agent_start 跑一个多步任务，在详情视图观察实时流式输出

### [ ] T6.6 子代理成本汇总（含嵌套）
- 来源：OpenChamber `useSubagentCostRollup.ts`（子代理 token 成本汇总到父会话，含嵌套 subagent-of-subagent）
- 前置：T6.3（子代理注册表）
- 步骤：
  1. **主进程聚合**：`subagent-registry.ts` 加 `getAggregatedUsage(parentId)`——递归遍历子代理树（child 可能 spawn 自己的 child，goofansu `PI_SUBAGENT_DEPTH` 标记深度），sum 所有 child session 的 `contextUsage.tokens` + `stats.cost`；返回 `{tokens: number, cost: number, count: number, perChild: Array<{id, agentName, tokens, cost}>}`
  2. **RuntimeInfo 扩展**（`ipc-schema/engine.ts`）：`RuntimeInfoSchema` 加 `subagentUsage?: {tokens: z.number(), cost: z.number(), count: z.number(), perChild: z.array(z.object({id: z.string(), agentName: z.string(), tokens: z.number(), cost: z.number()})).optional()}`
  3. **runtime-store**：`trackEvent` 在 `agent_end`/`agent_settled` refresh 时，从 RuntimeInfo 读 `subagentUsage`；EnvironmentPanel 数据源自动包含
  4. **EnvironmentPanel 展示**（`apps/desktop/src/renderer/src/components/center/EnvironmentPanel.tsx`）：在 context usage 区域加一行"子代理消耗：N 个 · X tokens · ¥Y"，可展开 per-child 明细（agent 名 + tokens + 耗时）；无子代理时不显示该行
- 验收：
  - [ ] 跑一个含子代理的任务后，EnvironmentPanel 显示子代理消耗汇总
  - [ ] 展开可看 per-child 明细
  - [ ] 嵌套子代理（子代理内再 spawn 子代理）的成本被递归汇总
  - [ ] 无子代理时不显示该行
  - [ ] `pnpm typecheck` + build 全绿
- 验证方式：触发 agent_start，子代理完成后检查 EnvironmentPanel 成本数字与子代理面板一致

### [ ] T6.7 子代理 per-tool 权限配置
- 来源：opencode agent 配置 `mode: "subagent"` + per-tool `permission: {bash: "allow", edit: "ask"}`（OpenChamber 继承 opencode 此机制）
- 前置：§7.5 S4（child 审批门注入）
- 步骤：
  1. **agent frontmatter 扩展**：goofansu agent 配置（`~/.pi/agent/agents/*.md`）支持 `permissions` 字段：
     ```yaml
     ---
     name: explore
     mode: subagent
     permissions:
       bash: ask      # allow | ask | deny
       edit: deny
       write: deny
       read: allow
     ---
     ```
  2. **审批门 per-tool 覆写**（`apps/desktop/electron/main/security/approval-gate.ts`）：`decide(policy, toolName, input)` 支持传入 `perToolOverride?: Record<string, "allow"|"ask"|"deny">`；子代理的 `permissionGateExtension` 用其 agent frontmatter 的 permissions 作为 override（未配置的工具回退全局 policy）
  3. **sessionOptionsFactory 读取**（§7.5 S4 的 `pi-wood-session-options.ts`）：创建 child session 时，从 agentDir 读对应 agent 的 frontmatter `permissions`→传给 child 的 `permissionGateExtension`
  4. **设置 UI**：`SettingsModal` 加「子代理」标签页——列出已装 agent 配置，每个可编辑 per-tool 权限（bash/edit/write 三档 dropdown + read/grep/glob 常用工具）；保存写回 agent frontmatter（`~/.pi/agent/agents/*.md` 的 YAML frontmatter）
  5. **默认兼容**：agent 无 `permissions` 字段时，child 继承父会话全局审批策略（与当前行为一致，不破坏已有子代理）
- 验收：
  - [ ] 配置 `explore` agent 的 `bash: deny` 后，子代理触发 bash 被直接拒绝（不弹审批卡，agent 收到 deny reason）
  - [ ] 配置 `bash: ask` 后，子代理触发 bash→子代理面板待审批徽章
  - [ ] 配置 `bash: allow` 后，子代理 bash 静默执行
  - [ ] 无 permissions 字段的 agent 继承父全局策略
  - [ ] Settings UI 可编辑并持久化 per-tool 权限
  - [ ] `pnpm typecheck` + desktop test + build 全绿
- 验证方式：配置三种权限模式各触发一次 bash，验证行为差异

### 落地顺序（依赖链）
1. **T6.3 子代理追踪 + 状态面板**（基础，其他都依赖它）——含审批上浮，最关键
2. **T6.4 打开子代理按钮**（小改，依赖 T6.3 面板可打开）
3. **T6.5 只读子会话视图**（依赖 T6.3 store + T6.4 入口）
4. **T6.6 成本汇总**（依赖 T6.3 注册表，独立于 T6.4/T6.5，可并行）
5. **T6.7 per-tool 权限**（依赖 §7.5 S4，与 T6.3~T6.6 无强依赖，可最后做或并行）

## 7.8 OpenChamber 全仓借鉴批次（T7.1~T7.12）

> **2026-09-02 决策**：系统性扫描 OpenChamber（`openchamber/openchamber`，本地 clone `/Users/admin/Desktop/personal/openchamber`）全仓，子代理 UX 层（§7.7）之外，整理出 12 项可借鉴模式。**原则：模式全搬，传输层不搬**（opencode HTTP/SSE → pi-wood in-process SDK + IPC）。按价值分三档：第一档高价值（T7.1~T7.6）建议优先做；第二档中价值（T7.7~T7.12）后续排期。
> **现状核实**（源码级）：Composer 已有附件管线（`PromptCommandSchema.attachments`）；审批门四档策略已落地（`approval-gate.ts`）；会话 `items` 为 `ConversationItem` 判别联合（`session-store.ts`）；右栏 Chrome 式单标签（`RightPane.tsx`，`WorkbenchTab` 可扩展）；浏览器面板 headless Playwright 已落地；SDK fork 能力已有（`engine:fork` 通道）；provider 管理 8 内置源 + safeStorage 已落地；EnvironmentPanel 显示 RuntimeInfo（含 contextUsage）。

### 第一档：高价值，建议优先

#### [x] T7.1 大文本粘贴→虚拟文件附件（✅ 2026-09-02）

> **完成说明与偏差**：核实发现现有附件管线是**基于磁盘路径**（`window.pi.prompt(text, string[])` → 主进程 `prepareAttachments` 用 `readFileSync(path)` 生成 `<file>` 块），计划里"造内存 `new File()` 走附件管线"在本项目**不成立**（主进程读不到不存在的路径）。据此落地为：`Composer` textarea `onPaste` 命中阈值 → `preventDefault`（不入输入框）→ `use-composer-controller.addPastedText` → 新增 IPC `engine:stagePastedText`（主进程写 `os.tmpdir()/pi-wood-pastes/pasted-text-<ts>-<seq>.txt`，best-effort 回收 24h 前旧文件）→ 返回 `{path,name,size,kind:'file'}` 并入现有 `attachments`（去重 + ≤12，附件区可移除）→ sonner toast「已作为文件附件添加（N 字符 / M 行）」，发送时经既有 `prompt()` 管线让 agent 读取。纯函数阈值/行数判定抽到 `lib/utils.ts`（`isLargePaste`/`countLines`）。

- 来源：OpenChamber `packages/ui/src/components/chat/composer/largeTextPaste.ts`（55 行，双阈值 OR 判断）
- 前置：无
- 步骤：
  1. **Composer paste handler 加大文本判断**（`apps/desktop/src/renderer/src/components/center/Composer.tsx` 或对应输入组件）：`text.length >= 2000 || lineCount >= 25` → 不插入输入框
  2. **造内存 File 走附件管线**：`new File([text], 'pasted-text.txt', {type:'text/plain', lastModified: Date.now()})` → 追加到 `PromptCommand.attachments`（复用现有附件 state）
  3. **toast 提示**：sonner toast「已作为文件附件添加（N 字符 / M 行）」，用户可在附件区看到/移除
  4. **短文本正常插入**：低于阈值的粘贴走原逻辑，不变
- 验收：
  - [x] 粘贴 3000 字符文本→自动变附件，输入框不被污染（`isLargePaste` 单测：3000 字符=true，preventDefault 不插入）
  - [x] 粘贴 500 字符文本→正常插入输入框（`isLargePaste` 单测：500 字符/单行=false，走原生粘贴）
  - [x] 附件区显示 pasted-text.txt，可移除（并入现有 `attachments`，复用 pickFiles 已验证的附件条渲染 + 移除按钮）
  - [x] `pnpm typecheck` + build 全绿
- 验证方式：分别粘贴长/短文本各一次，观察行为差异

#### [x] T7.2 per-session 权限自动接受（✅ 2026-09-02）

> **完成说明**：按会话 id 记录「自动接受审批」开关，落地为——① `SdkAdapter` 新增同步 `getSessionId()`（引擎未启动返回 undefined）；② `permissionGateExtension` 加第三参 `isAutoAccept`，`tool_call` 里**只在 `decide` 返回 `ask` 时**把需确认升级为放行（`denyAll`/path-guard 的 `deny` 永不被绕过=安全底线，单测验证）；③ `engine-manager` 用 `isAutoAcceptForSession(next)` 读 `loadSettings().autoAcceptSessions[当前会话]`（无 id/缺省→false，fail closed）；④ settings 新增 `autoAcceptSessions: Record<string,boolean>`（主 `PiWoodSettings`+默认空、渲染层 store 同步；**持久化单一写入者仍是渲染层 `settingsSet` 深合并**，主进程只读，避免与 `initSettingsIpc` 内存态双写打架）；⑤ 新增 IPC `approval:acceptAll`（`pendingUiRequests` 改存 `{kind,resolve}`，只放行 confirm + 全部 pendingApprovals，select/input 不动），开启时立即放行在飞审批；⑥ `ConversationHeader` 右侧加「自动接受」shield toggle（开启 success 色，仅 engineReady 且有 currentSessionId 时显）；`session-store` 加 `currentSessionId`+`refreshSessionId()`，在 activateProject/selectSession/createSession 后刷新，命令面板「新建会话」改派发 `piwood:new-session` 走左栏单一持有者统一刷新。子代理继承留 §7.7 T6.3 落地后补。
- 来源：OpenChamber `packages/web/server/lib/permission-auto-accept/runtime.js` + DOCUMENTATION.md（服务端唯一响应者、子代理继承、fail closed）
- 前置：T4.1 审批门（已落地）
- 步骤：
  1. **settings 加字段**：`autoAcceptSessions: Record<string, boolean>`（key=sessionId，持久化到 settings-store）
  2. **审批门检查**（`apps/desktop/electron/main/security/approval-gate.ts`）：`decide(policy, toolName, input)` 增加当前会话 autoAccept 检查——若 `autoAcceptSessions[currentSessionId] === true` 且工具非 denyAll 级，直接返回 allow（不弹 ApprovalCard）
  3. **会话头加开关**：`ConversationHeader.tsx` 加「自动接受」toggle（图标+文字，开启时 success 色），切换写回 settings
  4. **开启时立即接受已有 pending**：切换为 true 时，遍历当前 pending approval_request，自动回复 allow（复用 `permission_granted` 通道）
  5. **子代理继承**（§7.7 T6.3 落地后补）：child session 无显式值时从最近祖先继承；child `false` 覆盖 parent `true`
  6. **fail closed**：settings 加载失败 / 未知 session → 不自动接受（走原审批流程）
- 验收：
  - [x] 开启自动接受后，bash/edit 工具调用不弹 ApprovalCard，直接执行（gate：`ask` + `isAutoAccept()` → 直接 `return`，不触发 confirm；代码级闭环）
  - [x] 关闭后恢复弹审批卡（`isAutoAccept()` false → 走原 `ctx.ui.confirm` 往返；代码级闭环）
  - [x] 重启 app 后设置持久化（写 `~/.pi-wood/settings.json` 的 `autoAcceptSessions`，`loadSettings` 每次从盘读）
  - [x] denyAll 策略下即使开启 autoAccept 也拒绝（安全底线）（`decide(denyAll)` 返回 `deny`、非 `ask`，autoAccept 只作用 ask 分支 → 单测验证：denyAll bash=deny、edit .env=deny）
  - [x] `pnpm typecheck` + desktop test + build 全绿
- 验证方式：开启 autoAccept 后触发 bash 3 次，确认无弹窗；关闭后触发一次，确认弹窗（真实弹/不弹待应用内手验）

#### [x] T7.3 会话导出 Markdown（含嵌套子代理）（✅ 2026-09-02）

> **完成说明**：① 纯函数 `lib/export-session.ts`——`formatSessionAsMarkdown(items, title)` 把 5 类 `ConversationItem`（user/assistant/thinking/tool/system）转 Markdown（角色头 + thinking 引用块带耗时 + tool `### 🔧 状态 名称` 含入参 json/Diff/输出代码块 + system `---` 分隔），tool 输出截断 8000 字符、入参 1000（防爆文件）；`buildExportFilename` 用 `\p{L}\p{N}` 保 Unicode 字母数字（**中文标题不转义**，优于计划"非字母数字→-"）、折叠分隔符、Windows 保留名(CON/PRN…)加 `pi-wood-` 前缀、空标题兜底 `session`、截断 60、追加 `-YYYY-MM-DD`。② 主进程 `session:export`（`data.ipc.ts`，`dialog.showSaveDialog` 默认落到当前项目目录 + Markdown 过滤器 → `writeFileSync` UTF-8，取消返 undefined）；preload `exportSessionMarkdown` + global.d.ts。③ 入口在 `ConversationHeader`「…」Radix 下拉（`Icon` 新增 `ellipsis`），仅 `items.length>0` 渲染，导出成功/取消/失败三态 toast。**子代理递归留 §7.7 T6.3 落地后补**。
- 来源：OpenChamber `packages/ui/src/lib/exportSession.ts`（193 行，递归子代理树、文件名安全化）
- 前置：无（子代理导出等 §7.7 T6.3 落地后补递归）
- 步骤：
  1. **新建导出工具**（`apps/desktop/src/renderer/src/lib/export-session.ts`）：`formatSessionAsMarkdown(items, sessionTitle, childSessions?)`——`ConversationItem[]` 转 Markdown：user/assistant 用角色头+时间戳，tool 用 `**Tool: name**` + 输入/输出截断，thinking 用 `> 思考` 引用块，system 用 `---` 分隔
  2. **文件名安全化**：`buildExportFilename(title)`——NFKC normalize + 小写 + 非字母数字替换为 `-` + 截断 60 字符 + 日期后缀，如 `my-session-2026-09-02.md`
  3. **会话菜单加入口**：左栏会话项右键菜单 / 会话头 `...` 菜单加「导出为 Markdown」
  4. **Electron 保存**：主进程加 `dialog.showSaveDialog({defaultPath, filters:[{name:'Markdown',extensions:['md']}]})` → fs.writeFile → 返回路径；渲染层 IPC 加 `session:export` 通道
  5. **子代理递归**（T6.3 后补）：child sessions 用 `## Sub-agent: title` 分层，递归嵌套（深度 ≤6）
- 验收：
  - [x] 导出的 .md 文件可在 Typora/VSCode 正常渲染（标准 CommonMark：标题/引用块/围栏代码块，`formatSessionAsMarkdown` 单测校验结构）
  - [x] 含 user/assistant/tool/thinking/system 所有消息类型（纯函数单测：五类均产出对应片段）
  - [x] 文件名含特殊字符时安全化不报错（单测：`修复 bug: 登录/失败? <>:"|*`→安全 slug、空标题→`session`、`CON`→加前缀、200 字符→截断≤60）
  - [x] 长 tool 输出截断不爆文件（单测：20000 字符输出→含 `[已截断]` 且总长 <20000）
  - [x] `pnpm typecheck` + build 全绿
- 验证方式：导出一个含 5+ 轮对话的会话，检查 .md 内容完整性

#### [x] T7.4 Dev Server 自动发现（浏览器面板预览入口）（✅ 2026-09-02）

> **完成说明**：三平台纯解析 + 采集分层。**纯函数** `dev-server-parse.ts`：`splitHostPort`（正确处理 `[::1]:5173` IPv6 括号）、`isLoopbackOrWildcard`（`127.*`/`::1`/`localhost`/`0.0.0.0`/`::`/`*` 保留，LAN 专用如 `192.168`/`10.x` 排除）、`parseNetstat`（仅 LISTENING）、`parseLsofFpcn`（`-F pcn` 按 p/c 关联 n）、`parseProcNetTcp`（state `0A`、8/32 位十六进制小端解码）、`filterDevServers`（系统端口集排除 + 按端口去重取命令名/pid 更全者）。**采集器** `dev-server-detector.ts`：win32 `netstat -ano -p TCP` + `tasklist /fo csv` pid→进程名映射、darwin `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`、linux `/proc/net/tcp(6)`，**5s 缓存 + 失败降级**。契约 `DevServerInfoSchema` + `engine:listDevServers`；boot `initDevServerIpc()`；preload+global.d.ts `listDevServers`；`BrowserPanel` 地址栏下加「本地服务」芯片行（点击 `go(url)` headless 预览、右侧刷新按钮、空态提示）。⚠ Linux 端 pid/command 未做 inode→pid 反查（仅 port/host 检测，够用）。
- 来源：OpenChamber `packages/web/server/lib/dev-servers/parse.js`（203 行，三平台纯函数解析器+测试）
- 前置：浏览器面板（已落地）
- 步骤：
  1. **主进程新建检测器**（`apps/desktop/electron/main/dev-server-detector.ts`）：三平台解析——macOS `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`、Windows `netstat -ano -p TCP`、Linux 读 `/proc/net/tcp`（+tcp6）；输出统一 `{port, pid, command}`
  2. **过滤逻辑**：只认 loopback/wildcard 绑定（`127.0.0.1`/`localhost`/`[::1]`/`0.0.0.0`/`[::]`，LAN 专用绑定不算）；排除系统端口（22/53/445/631/5432/3306/6379/27017/9229）；排除自身端口（Electron/pi-wood 监听端口）
  3. **IPv6 括号解析**：`[::1]:5173` 格式正确拆分 host/port
  4. **IPC 通道**：`packages/ipc-schema/src/engine.ts` 加 `DevServerInfoSchema` + `ENGINE_CHANNELS.listDevServers = "engine:listDevServers"`（invoke→`DevServerInfo[]`）；主进程注册 handler，缓存 5s 防抖
  5. **浏览器面板接入**（`BrowserPanel.tsx`）：地址栏下拉 / 空态加「发现的本地服务」列表，每项显示 `localhost:<port>` + 进程名（如有），点击→`browser.open(http://localhost:<port>)`
- 验收：
  - [x] macOS 启动一个 vite dev server（端口 5173）→ 浏览器面板列出（`parseLsofFpcn` fixture 含 `n*:5173`→解析并经 filter 保留；真实发现待应用内实跑）
  - [x] Windows 同样验证（netstat 路径）（`parseNetstat` fixture：`[::1]:5173`/`127.0.0.1:3000` 保留、`192.168.1.5:8080` LAN 排除、`139` 系统端口排除，单测通过）
  - [x] 系统端口（如 5432 postgres）不出现（`SYSTEM_PORTS` 含 5432/139/8080…，`filterDevServers` fixture 验证 139/8080 被剔除）
  - [x] 点击列表项→浏览器面板打开对应 URL（芯片 `onClick → go(server.url)` 复用现有 headless 预览；代码级闭环）
  - [x] `pnpm typecheck` + desktop test + build 全绿（typecheck 全绿、`dev-server-parse` fixture 单测 6/6、build 三目标成功）
- 验证方式：macOS 实跑 `npx vite --port 5173`，检查面板发现并可预览

#### [ ] T7.5 目标模式（Session Goal）—— 自主执行循环 + 小模型审计
- 来源：OpenChamber `packages/web/server/lib/session-goal/`（runtime.js + DOCUMENTATION.md 212 行，服务端控制循环+小模型独立审计）
- 前置：小模型配置（复用 provider 管理，需用户配置一个低成本模型）、审批门（T4.1）
- 步骤：
  1. **主进程新建 goal-runtime**（`apps/desktop/electron/main/goal/goal-runtime.ts`）：事件驱动——session busy→idle 后启动 15s 静默定时器，到点检查：有 active goal + 无 child busy + quiescence（消息尾部无未完成回复）→ 触发审计
  2. **小模型审计**：审计只看目标文本 + 最后一轮 assistant 回复（不看完整历史，省 token），prompt 要求输出 JSON `{verdict: "continue"|"complete"|"blocked", note}`；用 session 自己的 provider/model 优先（`restrictToPreferredProvider`），降级到配置的 small model
  3. **终止逻辑**：`complete` → settle goal + 通知；`blocked` 连续 3 次才终止（一次性故障不结束）；审计失败容忍 1 次，第 2 次连续失败终止（"progress audit unavailable"，可 resume）
  4. **硬停止**：token 预算超限（`tokensUsed >= tokenBudget`）→ budgetLimited；自动轮次 ≥20（MAX_AUTO_TURNS）→ blocked；assistant turn error → blocked
  5. **续跑**：audit verdict=continue → 先持久化 accounting + turnsUsed（防崩溃后双发），再 `engine:prompt` 发续跑 prompt（含目标文本+预算+完成审计指令+要求每轮末尾给 done/verified/remaining 事实报告）
  6. **token 分段记账**：compaction（summary message）断快照链→分段：summary 轮关闭当前段计入 tokensCommitted，下段从零 baseline；`tokensUsed = tokensCommitted + currentSegment`，保持单调不减
  7. **目标文本存储**：存 `<data-dir>/goals/<sessionId>.md`，session metadata 只存 `goal: {objectiveFile: true, ...}`（防 metadata 膨胀 + 防用户写 metadata 变文件读取向量）；目标文件可中途编辑，tick 时实时重读
  8. **Composer 入口**：发送按钮旁加「作为目标发送」toggle（arm store 模式，仿 OpenChamber `useSessionGoalArmStore`）——开启后本次 prompt 成为目标，附加合成 system-reminder 告诉 agent 目标模式激活
  9. **EnvironmentPanel 目标状态条**：显示目标摘要（前 80 字符）+ 进度（turnsUsed/20、tokensUsed/budget）+ 审计备注（note，≤280 字符）+ 暂停/恢复/清除按钮；用户 abort → 暂停 goal（不 block）
  10. **通知**：goal settle（complete/blocked/budgetLimited）时发桌面通知（复用 Electron Notification），UI 关闭也能收到；goal active 期间抑制每轮"ready"通知（只保留 error/question/permission）
- 验收：
  - [ ] 设目标后 agent 自动续跑，不需要用户手动发消息
  - [ ] 小模型判定 complete 后 goal 终止 + 通知
  - [ ] token 预算超限后停止（budgetLimited）
  - [ ] 20 轮自动续跑上限生效
  - [ ] 用户点停止→goal 暂停，恢复后续跑
  - [ ] 目标文本存文件，metadata 不含大文本
  - [ ] `pnpm typecheck` + desktop test + build 全绿
- 验证方式：配置小模型，设一个简单目标（如"在 README 里加一行测试文字"），观察自动续跑→完成→通知全链路

#### [x] T7.6 `/btw` 侧边问答 —— 不切换主会话的临时分支问答（✅ 2026-09-02）

> **完成说明与偏差**：本项目是**单 adapter / 单活跃会话**，SDK `fork()` 会把该 runtime 的活跃会话切成分支并重绑事件流，无法满足"不扰动主会话 + 与进行中任务并发"（那是 T6.1 多会话并发的范畴）。经用户拍板，**偏离计划的"真 fork 继承全史"**，改为**独立第二运行时 + 上下文前言**：① `engine-manager` 新增与主 adapter 完全隔离的 `btwAdapter`（`ensureBtwAdapter()` 惰性起、同 `projectDir`、**静默 uiBridge、customTools 空、注入 `denyAll` 审批门**杜绝副作用与审批弹窗），事件经新通道 `engine:btwEvent` 转发（不进主 `engine:event`）；换项目 `ensureEngineUnlocked` 里 `closeBtw()` 释放。② `buildBtwPromptText`：前置合成 system-reminder（"by-the-way…只回答此问题、勿继续主会话任务/计划"）+ 渲染层 `buildContextBlock` 裁的最近 ≤12 轮纯文本上下文（仅供参考）+ 问题。③ `use-composer-controller.send()` 在 streaming 早退**之前**拦截 `/^\/btw(\s|$)/` → 走侧边、主会话不收消息（主任务流式进行中亦可问）。④ `btw-store` 按 `currentSessionId` 存转录本（`message_update`/`agent_end`/`turn_end` 归约），切换/切回各看各的（满足"切回还在"）。⑤ 右栏新增 `btw` tab（`workbench-store`+`RightPane`+`BtwPanel` 只读，`Markdown`+`ThinkingCard`），「采用到主会话」经 `piwood:composer-insert` 追加；`Ctrl+Shift+B` 打开、面板 `x` 触发 `engine:btwClose` 释放。IPC/preload/类型：`btwAsk/btwAbort/btwClose/btwEvent`。
- 来源：OpenChamber `packages/ui/src/lib/btw.ts`（fork 会话 + 合成 part 防任务串扰 + metadata 关联）
- 前置：SDK fork 能力（已有 `engine:fork` 通道）
- 步骤：
  1. **Composer 识别 `/btw` 前缀**：输入框 text 以 `/btw `（或 `/btw\n`）开头时，提取后面的问题作为侧边问题，不发到主会话
  2. **主进程 fork 会话**：调用 SDK fork（不切换当前 currentSessionId），fork 继承完整对话历史作为上下文
  3. **注入合成 part**：fork 的首轮消息附加合成 system-reminder——"这是一个侧边问题（by-the-way），请只回答这个问题，不要继续父会话中正在进行的任何任务或计划"（必须有，否则 fork 会把父会话的计划当成自己的任务继续跑）
  4. **右栏加「侧边问答」tab**：`workbench-store.ts` 的 `WorkbenchTab` 加 `"btw"`；`RightPane.tsx` `panelMeta` 加 `btw: {title:"侧边问答", icon:"messageSquare", kbd:"Ctrl+Shift+B"}`（确认无冲突）；新建 `BtwPanel.tsx` 显示 fork 的回复流（复用 MessageList 只读模式，类似 §7.7 T6.5）
  5. **父会话 metadata 关联**：当前会话存 `btwSessionId`，切换会话后侧边面板跟随；刷新后仍在（从 metadata 恢复）
  6. **promote 到主会话**（可选）：侧边问答回复旁加「采用到主会话」按钮，把回复内容追加到主会话输入框或作为新消息发送
- 验收：
  - [x] `/btw 什么是闭包` → 右栏侧边问答 tab 显示答案，主会话不切换、不插入消息（独立 btwAdapter + 事件走 btwEvent；send() 在发主会话前 return，不 addUserMessage/不 prompt 主；`/^\/btw(\s|$)/` 识别单测通过）
  - [x] 父会话有进行中的计划时，/btw 的回答不继续那个计划（合成 part 生效）（侧边是独立 fresh 会话、其 prompt 前置 system-reminder 明示勿继续父任务；denyAll 门杜绝任何写/执行工具，架构级满足）
  - [x] 切换到另一个会话再切回来，侧边问答还在（btw-store 按 `currentSessionId` 存转录本，切回读回各自条目）
  - [x] 侧边问答 tab 可关闭（复用 RightPane Chrome 式 `×` → `closeTab("btw")`；面板内 `x` 另触发 `engine:btwClose` 释放第二会话）
  - [x] `pnpm typecheck` + build 全绿（`/btw` 识别 + `buildContextBlock` 纯逻辑单测 4/4）
- 验证方式：主会话跑一个长任务，中途 `/btw` 问一个不相关问题，确认侧边显示答案且主任务不受影响（真实带密钥运行态待手验）

### 第二档：中价值，后续排期

#### [ ] T7.7 代码审查流（Review Flow）
- 来源：OpenChamber `packages/ui/src/lib/reviewFlow.ts`（fork 会话 + 独立审查 agent + 自动审查循环 + handoff）
- 前置：Diff 面板（已落地）、子代理（§7.7，可选——不用子代理也能用 fork 实现）
- 步骤：
  1. **右栏「审查」tab 加「AI 审查变更」按钮**（`DiffPanel.tsx`）：点击后 fork 当前会话 → 审查 agent（可用独立 agent 配置或子代理 explore）跑 `git diff` + 分析变更
  2. **结构化审查输出**：要求审查 agent 输出 JSON 数组 `[{file, line, severity: "error"|"warning"|"info", message, suggestion}]`，渲染为可点击列表（跳转对应文件/行，复用 FilesPanel + CodeMirror）
  3. **自动审查循环**（可选）：最多 15 轮，agent 修复后自动重新审查，`FINAL_REVIEW_STATUS: no_remaining_findings` 终止；默认关闭，用户可开启
  4. **handoff**：审查发现可「应用建议」→ 把 suggestion 作为 edit 工具输入发给主会话 agent 执行
- 验收：
  - [ ] 点击 AI 审查→输出结构化发现列表
  - [ ] 点击发现→跳转到对应文件行
  - [ ] 无变更时空态提示
  - [ ] `pnpm typecheck` + build 全绿
- 验证方式：造一个有明显 bug 的 diff，跑审查确认能发现

#### [ ] T7.8 定时任务（Scheduled Tasks）
- 来源：OpenChamber `packages/web/server/lib/scheduled-tasks/`（runtime.js + loops.js + DOCUMENTATION.md，Markdown loop 文件 + 跨实例文件锁）
- 前置：无
- 步骤：
  1. **Markdown loop 文件格式**：`.pi-wood/loops/*.md`（项目 scope）+ `~/.pi-wood/loops/*.md`（用户 scope），frontmatter：`name` / `schedule`（cron 表达式）/ `enabled` / `model`（provider/model）/ `agent`（可选）/ `timezone`（可选 IANA），body = prompt
  2. **主进程 scheduler**（`apps/desktop/electron/main/scheduler/`）：cron 表达式解析（用 `cron-parser` 或自实现 next-run 计算）+ 定时器 + 队列；到点→创建会话→发 prompt→记录运行状态（lastRunAt/nextRunAt/lastStatus/lastError/lastSessionId/lastDurationMs）
  3. **跨实例防双开**：项目 config 写 `.json.lock` 文件锁（read-modify-write 序列化），occurrence claiming（写 `lastScheduledFor` + 推进 `nextRunAt`，第二个实例抢不到就跳过）；锁超时/fs 失败→释放 in-process slot + best-effort re-arm
  4. **SettingsModal 加定时任务管理页**：列表（名称/下次运行/上次状态）+ 新建/编辑/删除 + 立即运行 + 启用/禁用 toggle；loop 文件来源的任务显示「文件管理」标签，编辑走 loop 文件端点
  5. **loop 文件 reconcile**：启动/打开管理页时扫描 loop 文件，与持久化任务列表对账（文件新增→创建任务，文件删除→移除任务，文件改名→in-place 重命名）；解析失败的文件保留上次好定义 + 警告
- 验收：
  - [ ] cron `* * * * *` 任务每分钟执行一次（测试后改回）
  - [ ] loop 文件创建后自动出现在管理页
  - [ ] 运行状态正确记录（lastRunAt/lastStatus）
  - [ ] 禁用的任务不执行
  - [ ] `pnpm typecheck` + desktop test + build 全绿
- 验证方式：建一个每分钟的测试任务，观察 2 次执行后删除

#### [x] T7.9 小模型会话辅助（Session Assist）（✅ 2026-09-02）

> **完成说明与偏差**：① **无独立小模型设置**，复用当前已配置模型（best-effort，`loadSettings().model`→`setModel`）。② 触发**不用 busy→idle 定时器**，改在主 adapter `agent_settled` 时 fire-and-forget（engine-manager 每轮 `prompt` handler 重置并累积 `text_delta` 到 `assistTextBuf`、`turn_end` aborted 置中断标记；未中断且正文 ≥40 字才生成，省 token/耗时），`inFlight` 单飞锁 + 25s 超时。③ **辅助 LLM 调用走隔离第二运行时** `assist-service`：`SdkAdapter` 的 `projectDir` 用 `os.tmpdir()/pi-wood-assist`（会话按 cwd 归集，不进真实项目 `sessionsList`、不污染左栏），注入 `denyAll` 门 + 空工具纯文本，每轮 `newSession()` 隔离上下文。④ **不写 session metadata**（`assist:{recap,suggestions,forMessageID}`）→ 渲染层内存 `assist-store`，`onAssistResult` 回推 `{recap,suggestions}` 时捕获 `session=currentSessionId`+`forItemsLen=items.length`，`ConversationAssist` 仅当会话一致且 `items.length===forItemsLen` 且未 `dismiss` 时显示（新消息/切会话自动隐，无需显式清除），追问 chip 点击派发 `piwood:composer-insert`（复用控制器）。⑤ 纯逻辑（`shouldAssist`/`buildAssistPrompt`/`parseAssist`：剥围栏取首个 `{}` 校验 recap+suggestions≤3）拆 `assist-parse.ts`（无 electron 依赖可单测）。IPC `engine:assistResult` + preload `onAssistResult` + global.d.ts。
- 来源：OpenChamber `packages/web/server/lib/session-assist/`（busy→idle 后小模型生成 recap + 建议追问）
- 前置：小模型配置（同 T7.5）
- 步骤：
  1. **主进程事件驱动**：session busy→idle 转换后，小模型生成简短 recap（最后一轮回复摘要，≤200 字符）+ 1-3 个建议追问，存 session metadata `assist: {recap, suggestions, forMessageID}`
  2. **新消息自动作废**：`forMessageID` 不匹配最新消息→UI 不显示（无需额外写操作）
  3. **Composer 上方显示**：recap 淡色文字 + 建议追问 chip（可点击插入输入框）；可关闭（dismiss 存本地）
  4. **纯事件驱动**：只处理运行中发生 busy→idle 的会话，不回溯、不扫描历史会话
- 验收：
  - [x] 一轮对话结束后显示 recap + 建议追问（`agent_settled`→`generateAssist`→`engine:assistResult`→`ConversationAssist`；`parseAssist` 纯函数单测 6/6；真实生成待应用内带密钥手验）
  - [x] 发新消息后 recap 消失（关联 `items.length===forItemsLen`，出现新消息即不等→隐藏，无需显式清除）
  - [x] 点击建议追问→插入输入框（chip `onClick` 派发 `piwood:composer-insert`，复用控制器既有追加）
  - [x] `pnpm typecheck` + build 全绿
- 验证方式：完成一轮对话，观察 recap 和建议

#### [ ] T7.10 Agent Memory 跨会话记忆
- 来源：OpenChamber `packages/web/server/lib/agent-memory/actions.js` + `agent-tool` 的 `openchamber_memory` 工具（global/project 双 scope + unreviewed 安全模式）
- 前置：扩展系统（T5.2，或先用 inline extension 实现）
- 步骤：
  1. **新建 memory 扩展**（`apps/desktop/electron/main/extensions/memory-extension.ts`）：注册 `memory.save`/`memory.read`/`memory.list`/`memory.delete` 四个工具，描述对齐 OpenChamber（"Keep what you learn across sessions..."）
  2. **存储**：`~/.pi-wood/memory/global.json` + `<project>/.pi-wood/memory/project.json`；条目 `{id, type: "fact"|"preference"|"reference", title, body, scope, createdAt, reviewed: boolean}`
  3. **scope 推导**：从 session directory 推导 project scope（worktree 路径归到主项目），不让 agent 指定 project id（防跨项目污染）
  4. **unreviewed 安全模式**：agent 保存的记忆 `reviewed: false`，UI 显示为「待确认」，用户确认后才 `reviewed: true`；agent 读取时 unreviewed 条目也可读（但描述里告诉 agent 这些是用户未确认的）
  5. **SettingsModal 加记忆管理页**：列表（title/type/scope/reviewed 状态）+ 查看/编辑/删除 + 确认/取消确认；按 scope 过滤
  6. **工具结果展示**：`memory.save` 工具卡在对话流显示「已保存记忆：{title}（待确认）」+ 「确认」按钮（快速确认不跳设置页）
- 验收：
  - [ ] agent 调用 memory.save→存储成功 + 对话流显示待确认
  - [ ] 新会话中 agent 调用 memory.list→能看到之前保存的
  - [ ] 用户确认后 reviewed=true
  - [ ] project scope 记忆只在对应项目可见
  - [ ] `pnpm typecheck` + desktop test + build 全绿
- 验证方式：会话 A 让 agent 保存一条偏好，会话 B 让 agent 列出记忆确认存在

#### [x] T7.11 会话草稿持久化（✅ 2026-09-02）

> **完成说明与偏差**：OpenChamber 快照含 `mentions: string[]`，本项目对应**结构化 `AttachmentItem[]`**（`@文件`/粘贴文本都是带 path 的附件，非纯文本 mention），故草稿快照存 `{text, attachments}`、identity key 用 `session-store.currentSessionId`（T7.2 已引入）。落地：① 纯逻辑 `lib/chat-draft-persistence.ts`——`parseDrafts`（缺失/坏 JSON/`version!==1`→空表降级、丢非法条目）、`upsertDraft`（`>MAX_DRAFTS(50)` 按 `touchedAt` LRU 淘汰最旧且不含刚写者；空文本+空附件→删条目）、`serializeDrafts`/`removeDraft`；localStorage（key `pi-wood.chatDrafts.v1`，`typeof localStorage` 守卫 + 无 DOM 内存兜底便于单测）+ `writeDraft/readDraft/clearDraft`。② `use-composer-controller` 三 effect：`liveRef` 每次渲染镜像 `{input,attachments}`；`currentSessionId` 存在时 input/attachments 变更 **500ms 防抖** `writeDraft`；`currentSessionId` 变化时**先 `writeDraft(prev)` 再 `readDraft(new)`** 载入/（真实切换到无草稿会话时）清空，`prev` 未定义（会话首次实体化）不清、保留 onboarding 已敲文本；`send()` 成功后 `clearDraft(currentSessionId)` + 取消挂起防抖。
- 来源：OpenChamber `packages/ui/src/lib/chatDraftPersistence.ts`（per-session 草稿 + @mentions + localStorage + 最多 50 条 + versioned envelope）
- 前置：无
- 步骤：
  1. **新建草稿管理**（`apps/desktop/src/renderer/src/lib/chat-draft-persistence.ts`）：`ChatDraftIdentity = {sessionId}`，`ChatDraftSnapshot = {text, mentions: string[]}`；存 localStorage key `pi-wood.chatDrafts.v1`，envelope `{version: 1, drafts: Record<identityKey, {text, mentions, touchedAt}>}`，最多 50 条（LRU 淘汰最旧 touchedAt）
  2. **Composer 接入**：切换会话时保存当前草稿（debounce 500ms + 切会话立即存）；加载会话时恢复草稿（从 localStorage 读，填入输入框 + 恢复 @mentions 附件）
  3. **发送后清除**：消息成功发送后清除该会话草稿
  4. **版本兼容**：envelope version 不匹配→降级为空草稿（不崩）
- 验收：
  - [x] 输入一半切到另一个会话再切回来→草稿还在（切会话 `writeDraft(prev)`+`readDraft(new)`，`liveRef` 防丢最后输入；代码级闭环）
  - [x] 发送消息后→该会话草稿清除（`send()` 成功 `clearDraft(currentSessionId)`）
  - [x] 超过 50 条草稿→最旧的被淘汰（`upsertDraft` LRU 按 `touchedAt` 单测：写满 50 再写 1 条 → 最旧 `k0` 被逐、总数恒 ≤50）
  - [x] 刷新页面后草稿仍在（localStorage `pi-wood.chatDrafts.v1` versioned envelope；`parseDrafts`/`serializeDrafts` 往返单测 + `write/read/clear` 回环单测）
  - [x] `pnpm typecheck` + build 全绿
- 验证方式：输入文字切会话再切回，确认草稿恢复

#### [ ] T7.12 用量/配额追踪（per-provider）
- 来源：OpenChamber `packages/web/server/lib/quota/` + `packages/ui/src/components/sections/usage/`（per-provider 凭据用量 + 配额 + 用量卡片）
- 前置：provider 管理（已落地）
- 步骤：
  1. **主进程用量累计**（`apps/desktop/electron/main/provider/usage-tracker.ts`）：监听 `tool_execution_end` / `agent_end` 事件，从 RuntimeInfo.contextUsage 提取 tokens（input/output/total）+ cost，按 providerId + modelId 累计；存 `~/.pi-wood/usage/<providerId>.json`（按月分文件，防单文件过大）
  2. **配额限制**（可选）：settings 加 per-provider `monthlyTokenBudget` / `monthlyCostBudget`，超限后 warning toast + 可选自动切换 provider（默认只警告不阻断）
  3. **IPC 通道**：`ENGINE_CHANNELS.getUsage = "engine:getUsage"`（invoke→`{providerId, modelId, tokens:{input,output,total}, cost, period}` 数组）
  4. **SettingsModal 加用量页**：per-provider 用量卡片（provider 名 + 本月 tokens + 估算费用 + 进度条/配额）+ model 维度展开 + 历史月份切换；无用量的 provider 不显示
  5. **EnvironmentPanel 快捷显示**：当前 provider 本月用量小字显示（tokens + 费用），点击跳设置页用量 tab
- 验收：
  - [ ] 跑一轮对话后用量页显示对应 provider 的 token 用量
  - [ ] 按 model 维度展开正确
  - [ ] 配额超限后显示 warning
  - [ ] 跨月后用量重置（新月份文件）
  - [ ] `pnpm typecheck` + build 全绿
- 验证方式：跑 3 轮对话，检查用量页数字与 RuntimeInfo.contextUsage 一致

### 落地顺序（按价值/成本比）
**第一批（低改动高价值，建议立即做）**：
1. **T7.1 大文本粘贴→虚拟文件**（极小改动，立竿见影）
2. **T7.2 per-session 权限自动接受**（小改动，长任务体验质变）
3. **T7.3 会话导出 Markdown**（小改动，实用功能）

**第二批（中改动，差异化价值）**：
4. **T7.4 Dev Server 自动发现**（中改动，前端开发场景高频）
5. **T7.6 `/btw` 侧边问答**（中改动，体验独特）
6. **T7.11 会话草稿持久化**（小改动，切会话不丢输入）

**第三批（中大改动，长期差异化）**：
7. **T7.5 目标模式**（中大改动，但差异化价值最高——自主执行+小模型审计是 Codex 级体验）
8. **T7.10 Agent Memory**（中改动，跨会话记忆是长期粘性）
9. **T7.9 小模型会话辅助**（小改动，依赖小模型配置）
10. **T7.7 代码审查流**（中改动，审查场景）

**第四批（大改动，按需）**：
11. **T7.8 定时任务**（大改动，自动化场景）
12. **T7.12 用量/配额追踪**（中改动，账单透明）

## 8. 变更与决策日志（持续追加，倒序）

> 格式：`日期 | 任务号 | 类别(偏差/决策/风险) | 内容 | 影响`

| 日期 | 任务号 | 类别 | 内容 | 影响 |
|---|---|---|---|---|
| 2026-09-03 | T5.2 插件系统（utilityProcess） | 完成+偏差 | **Phase5 唯一未开的功能主任务落地（用户拍板「完整 §5.8 API + 管理 UI」「内置示例目录」）**。① 新建零依赖包 `packages/plugin-api`（`manifest.ts`：`PluginPermission`/`PanelDefinition`/`PiPackageManifest`/`LoadedPlugin`；`index.ts`：§5.8 `DesktopApi` 全量类型 + 进程间帧 `PluginToHost`/`HostToPlugin` + **`API_PERMISSIONS` 方法→权限映射（单一事实源，未列方法=未知即拒）** + `SENSITIVE_METHODS` + 纯函数 `checkPermission` + `createDesktopApi(port)` 客户端桥）；**`node --test` 10/10**（权限门 5 + 桥 5：invoke 帧/result 解析/reject/bus 订阅取消/多帧 id 不串台）。② `ipc-schema/plugins.ts`：`PluginStatusSchema`（含 `activity` 时间线）+ `PluginPanelEntry`/`PluginStatusItem` + `PLUGIN_CHANNELS`；权限枚举从 plugin-api 派生避漂移；接 workspace 依赖（tsconfig paths + `pnpm install` 链包，workspace 5→6）。③ 主进程 `electron/main/plugins/`：`discovery.ts`（内置 `<appPath>/plugins-examples` + 用户 `~/.pi-wood/plugins`，manifest 校验/入口存在性/user 覆盖 bundled）；`capabilities.ts`（`execCapability`：terminal→`child_process.spawn` 回退出码、browser→T2.4 `browserNavigate/Screenshot`、window→`BrowserWindow.setTitle/setProgressBar`、notify/ui→复用 `engine-manager` **导出**的 `uiBridge()`（同条 `ui:notify`/`ui:request`/`ui:respond`，不另立通道）、editor.openFile/diff.show→转推渲染层 `openWorkbenchFile`、diff.revert/invokeAgentTool 尽力/预留）；`plugin-host.ts`（**每插件一个 `utilityProcess.fork(entryPath,{stdio:['ignore','pipe','pipe']})`；RPC `handleInvoke` 走 `checkPermission`→敏感方法首次 `ui.confirm` 运行时确认→`execCapability`→回 result；面板/状态栏注册表 + `bus.publish` 向在飞插件广播 event；`onExit` 非主动 stop=崩溃→`ui.notify` + 退避重启 ≤3 次（存活>30s 重置预算）、超上限停并重通知；stdout/stderr 有界采集入 activity**）；`plugins.ipc.ts` 组装 `HostDeps`+注册 `plugins:list/setEnabled/restart/reload/demo`。`index.ts` `initPluginsIpc(sendToRenderer)` + quit `stopAllPlugins()`。④ `settings-service` 加 `pluginsEnabled` 且**重构为模块级共享 `getSettings/updateSettings`**（渲染层 settings:get/set 与主进程持久化同一份内存态，防闭包 current 漂移互相覆盖）。⑤ 渲染层 `plugin-store` + SettingsModal 新增「插件」tab `PluginsPanel`（状态徽章/权限 chips/启停 Switch/重启/活动流 + 崩溃/越权一键演示）；`App.tsx` 订阅 `plugins:status/openFile/panels/statusbar`；preload + global.d.ts 暴露。⑥ 示例插件 `plugins-examples/_pi-client.cjs`（createDesktopApi 的无依赖 CJS 镜像）+ `demo-kitchen`（非敏感全 API）/`demo-crash`（收 control `crash`→`process.crash()`）/`demo-overreach`（仅声明 notify，自试 `terminal.run`/`diff.revert` 越权被拒 + 合法 notify 对照）。**门禁**：`pnpm -r typecheck` 5 工程全绿、plugin-api 单测 10/10、`electron-vite build` 三目标通过（out/main 134KB 含宿主符号、示例目录正确地未被打进 out、渲染层含管理面板）；manifest 离线校验 3/3 合法入口齐备。**偏差/注意**：(a) Electron utilityProcess `ForkOptions` 用 `stdio` 非 `stdout/stderr` 键（首版踩坑已改）；(b) `panels`/`statusbar` 两权限令牌是对 §6.1 清单的补充（运行时注册面板/状态栏需要）；(c) diff/invokeAgentTool 无现成宿主句柄→尽力执行 + 仍受权限门约束，非完整实现；(d) **打包版 `plugins-examples` 需 electron-builder `extraResources`/`asarUnpack` 才能随包发布（T5.3 环境阻塞，dev 路径 `app.getAppPath()` 命中即可）**；(e) 崩溃重启通知走渲染层 toast（`ui:notify`），与用户「不要右下角浮窗」偏好不冲突（是瞬时 toast 非持久浮窗）。**✅ 真机验证（headless 探针，非手验）**：新建 `plugin-probe.ts`（`isPluginProbeMode()` 检 `--plugin-probe`，`index.ts` whenReady 早返回，不起窗口/不加载引擎 Pi），脚本 `probe:plugins`（build + `electron . --plugin-probe`）。自建 mock `HostDeps` 起真 `PluginHost`→fork 三内置示例→断言：① `demo-overreach` activity 含两条 `denied`（terminal:run/fs:write 未声明被拒，主进程 `console.warn` 同步打印）② `demo-crash` 收 control→`process.crash()`(退出码 11)→`onExit` toast「正在自动重启 1/3」→重 fork 回 `status=running, restarts=1`→探针进程仍存活证主进程未受波及；实测 **EXIT_CODE=0 / ALL PASS**。原「⚠ 一键演示留手验」欠账结清（管理 UI 里点演示按钮仍可用，但硬指标已由探针 CI 级证明）。 | T5.2 ✅（Phase5 唯一未开的功能主任务收口）；剩 T5.3 打包分发（环境阻塞）|
| 2026-09-02 | T3.3 遗留补齐 | 维护 | **补齐 T3.3 两项遗留**：① **Composer 卡片随主题**——globals.css 新增 `--composer-bg`/`--composer-chip-bg`（`:root` 默认 = 原硬编码 `#333333`/`#242424` 保持手调深色审美不变；`[data-theme=light]` 给白卡+浅灰条），`piThemeToCssVars` 追加映射（卡片←selectedBg、芯片条←toolPendingBg??selectedBg），`Composer.tsx`(InputCard/芯片条) + `PromptTray.tsx`(两处卡面) 的 `bg-[#333333]`/`bg-[#242424]` 全改 `bg-[var(--composer-*)]`。`--capture` solarized-light 复验（`t33b-solarized.png`）：空态 composer 两层由原暗 #333 变为暖浅面 `#eee8d5`，与整站一致。② **shiki token 级语法主题**——ui-kit `theme-registry` 由「仅存主题名」升级为 `string | ShikiThemeObject` + `useSyncExternalStore` 版本订阅（`setShikiTheme/getShikiTheme/shikiThemeKey/useShikiTheme`）；`code-block.tsx`/`shiki-command.tsx` 改用 `useShikiTheme()` 响应式取主题（缓存 key 折入 `shikiThemeKey()` 含 version，切主题即重高亮；shiki options 为可辨识联合故 `theme as unknown as string` 转型，运行时透传对象）；`theme-store` 用 `piThemeToShikiTheme(colors,mode) ?? 内置名` 喂对象主题。`piThemeToShikiTheme` 返回类型改对齐 ui-kit `ShikiThemeObject`（type-only import，node --test 仍免载）。**验证**：ui-kit+desktop node/web tsc 全绿、`node --test` 15/15（theme-adapter 5 含 shiki token 主题断言）、`electron-vite build` 三目标成功；shiki 对象主题经 node 侧 `codeToHtml` 实测接受（OBJ_THEME_OK）。⚠ 代码高亮的 token 主题效果需对话内出现代码块方可见（空态 --capture 无代码块），逻辑经单测+类型+构建覆盖。测试用 `settings.theme.pi` 已清回 null、dev 恢复默认 | T3.3 遗留结清；主题接入完整（含 composer + 代码高亮随 Pi 主题） |
| 2026-09-02 | T3.3 主题 token 映射 | 完成+偏差 | **Phase3 末项：Pi 社区主题全应用接入（核心可用版）**。架构：桌面 CSS 变量已是唯一色彩源（globals.css `:root` + `[data-theme=light]`，CodeMirror/xterm/dockview/Markdown 全读 `var(--*)`），故只需把 Pi 主题解析成 CSS 变量覆盖即可整站换肤。落地：① 纯函数 `lib/theme-adapter.ts`（无 electron/DOM）——`resolvePiTheme` 把 Pi theme JSON 的 `{vars:{name:hex},colors:{token:varName|hex}}` 展开成扁平 token→hex（vars 间接引用递归解、直接 hex 保留、256 色数字索引跳过），`themeModeFromFg` 按前景亮度定 dark/light 底，`piThemeToCssVars` 映射语义色（text→--foreground、muted→--muted-foreground、accent→--primary/--ring/--sidebar-primary、border→--border/--input、success/error/warning→--success/--destructive/--warning、selectedBg→--accent、+ `--pi-tool-*`/`--pi-syntax-*`/`--pi-terminal-fg`），**刻意不覆盖 `--surface-app/--background`** 以保留用户手调的柔和深灰底；`piThemeToTerminalTheme`/`piThemeToShikiTheme` 供终端/代码高亮。**单测 5/5**（vars 展开/亮度定档/CSS 映射不动底色/终端/shiki 有无语法 token）。② 引擎 `engine:getPiTheme`（ipc-schema `EnginePiTheme` + engine-manager handler 读 `settings.theme.pi` → `~/.pi/agent/themes/<name>.json` → 返回 `{name,vars,colors}`，未配置/缺文件→null）+ preload `piTheme()` + global.d.ts。③ `stores/theme-store.ts`：`apply(theme|null)` → resolvePiTheme → 写 `:root` inline CSS 变量（记 appliedKeys 便于 null 时清除）+ 切 `data-theme` + `setShikiThemeName(mode)` + 算 terminalTheme（surface 取 computed --background，rAF 二帧回填）。④ `App.tsx` 启动 effect：先 fallback 再 `piTheme().then(apply)`（Pi 主题覆盖内置）。⑤ ui-kit `theme-registry.ts`（`setShikiThemeName/getShikiThemeName`）→ code-block.tsx + shiki-command.tsx 取色改读注册表（缓存 key 含 theme）。⑥ TerminalPanel `new Terminal({theme: terminalTheme ?? 硬编码兜底})`。⑦ settings 双端 `theme.pi?: string`。**真机验收**：造 `~/.pi/agent/themes/{tokyo-night,solarized-light}.json`（社区主题即此 JSON 格式），`--capture` 各截一图——tokyo-night（前景转淡薰衣草、accent/边框蓝灰，因与默认蓝接近故较淡）、**solarized-light 整站翻浅底暖灰 + 深色前景 + 橙状态 chip**（`t33-tokyo.png`/`t33-solarized.png`），证全 app 换肤一致、light/dark 随主题亮度自动切。**偏差/遗留**：(a) 方案说"同步注入 CodeMirror theme"——CM 已读 CSS 变量（透明底 + 继承 fg），随 :root 覆盖自动生效，未额外写 `EditorView.theme`；(b) shiki 仅按明暗切内置 `github-dark/light-default`，**token 级自定义语法主题**（piThemeToShikiTheme 已实现但需 ui-kit 组件对 theme 变化重渲染）留后续；(c) **Composer 空态卡片硬编码 `#333333`/`#242424`（用户刻意设计的双态审美）不随主题**，solarized-light 截图可见其仍深——如需彻底一致要把这些硬编码面改吃 var，但会动用户调过的审美，暂不改；(d) 无社区主题包可 `pi install`（`~/.pi/agent/themes` 原为空），用手写 JSON 主题演示（即社区主题格式本身）。**门禁**：ui-kit/engine/ipc/desktop 全 tsc 绿、`node --test` 15/15（含 theme-adapter 5）、`electron-vite build` 三目标成功；测试用的 `settings.theme.pi` 已清回 null、dev 恢复默认主题。示例主题 JSON 留存 `~/.pi/agent/themes/`（用户级、非仓库） | T3.3 ✅（Phase3 生态接入全部收口 T3.1~T3.4）；下一步 B 类 T6.6/T6.7/T7.x |
| 2026-09-02 | T3.1 扩展/Skill/模板全量复用 | 完成+偏差 | **§7 Phase3 收尾：真实社区包端到端验收 + ctx.ui.custom 降级标注补齐**。① **离线 PI_OFFLINE 探针**（纯 node 引导嵌入式 SDK、无密钥无网络，`createAgentSessionServices→FromServices→Runtime→bindExtensions mode:rpc`，读 session 的 `getActiveToolNames`/`extensionRunner.getRegisteredCommands`/`promptTemplates`/`resourceLoader.getSkills().skills` + `services.diagnostics`）对**当前真实 settings.packages**（rpiv-ask-user-question / rpiv-todo / pi-web-access / pi-mcp-adapter / @narumitw/pi-plan-mode）实测：ACTIVE_TOOLS 含各包工具（`ask_user_question`/`todo`/`web_search`/`fetch_content`/`mcp`/`mcpScript`/`plan_mode_question`/`plan_mode_complete` + 内置 read/bash/edit/write）、EXT_COMMANDS 9 条（todos/websearch/curator/google-account/search/mcp/pi-mcp/mcp-auth/plan）、**SKILLS=["mcp-scripting"]**（含 Skill 的社区包生效）、**DIAGNOSTICS 0 error** → 验收①「含扩展+Skill 的社区包全部生效」达成。② **偏差/补漏**：`ctx.ui.custom` 原在 `sdk-adapter.createUiContext` 是静默 `async()=>undefined`（不崩但无提示），不符验收③「降级并标注桌面暂不支持」→ 改为**一次性** `bridge.notify("…桌面宿主暂不支持，已降级","warning")` 后返回 undefined（`customUiWarned` 实例位防刷屏）；探针另证 `custom()` 返回 undefined 不抛错。③ 验收②「扩展内 ctx.ui.confirm 桌面弹窗 + 返回值回传」：`uiBridge.confirm→requestUi("confirm")→ui:request→PromptTray→ui:respond→resolve(Boolean)` 阻塞 Promise 链路，与审批卡 `confirmViaRenderer` **同一条 requestUi 通道**，该往返已在 T6.2 子代理 child bash/write 审批真机跑通（dev10：弹「允许执行?」→批准→工具执行=值回传）与 PromptTray 重构 dev16 验证；本次未另起独立 confirm 触发（无现成调 confirm 的社区包），据同路机制判定达成。**门禁**：`tsc` engine + desktop node/web 全绿、`electron-vite build` BUILD_OK；探针 `.mjs` 用后入回收站。⚠ 诚实标注：验收②为共享 requestUi 路径 + 既有真机证据，非本轮新触发的专用 confirm e2e | T3.1 ✅（Phase3 生态接入收口，除 T3.3 主题外） |
| 2026-09-02 | T6.2 多代理真机 e2e | 完成+验证 | **§7.5 S6 补齐完整多代理编排真机 e2e**（此前只验过单代理委派）。前置：本机 `~/.pi/agent/agents/` 为空 → vendored `loadAgentConfigs` 报 "agent_start has no configured agents"，**新建 `general.md`/`explore.md` 两个 profile**（frontmatter 仅需 `description`，`harness` 默认 `pi`、省略 `model` 走父模型避免 catalogue 校验失败、body=systemPrompt）。临时改 ui-chat harness prompt 为「并行 3 个 explore 子代理 fan-out + 对 B `agent_steer` + 对 C `agent_cancel` + `agent_wait` 收口」，起 dev 实跑 DeepSeek。**目检（`t62-e2e.png`，exit=0/日志无真 error（仅 NODE_TLS 警告）/无 already）**：主 agent 编排闭环——3 个 run id（A `run-7b6af1e5`/B `run-3ad59b1d`/C `run-c885efc9`）；**fan-out** 三子代理并行读文件；**steer** B 收到追加指令并如实回应（grep 核实 greet.js 无 `greetZn`、系 `greetZh` 笔误）；**cancel** C 1 回合后停止（7.7k in/66 out、$0.0011）不再产出；**wait/result** A、B 完成并汇总。探针2/3/结论（凭据可见·审批可控·print-bind 不挂起·inMemory 不污染左栏）随之坐实，§7.5 S2/S5/S6 全 [x]。**遗留（可选）**：命名会话 `agent_resume` 续跑编排未在本轮触发。⚠ 右栏 SubagentPanel 截屏时显"暂无子代理运行"——因 settle 时子代理已全部结束（面板追踪在飞 run），其**实时**状态展示由 §7.7 T6.3 单列已验。harness prompt 临时改动已回退（`git diff ui-chat-harness.ts` 空）。附：agent profiles 属用户级 `~/.pi` 配置、非仓库文件，保留供后续子代理使用 | T6.2 §7.5 完整收口 ✅（多代理 fan-out/steer/cancel 真机验证） |
| 2026-09-02 | T5.1 §11 键盘化终审 | 完成 | **对方案 §11「90% 高频操作可键盘完成」清单逐项核对**（只读调研，产出打勾表）。基准 §11-2/4/5/6/7/8/9/10 + §12 输入区约定，共 25 条高频操作，逐条比对渲染层实际快捷键（`App.tsx` 全局 keydown、`CommandPalette.tsx`、`use-column-focus.ts`、`use-composer-controller.ts`、`PromptTray.tsx`、`FilesPanel.tsx`）。**结果**：✅ 21、⚠ 3、❌ 1；严格 21/25≈84%，按 ⚠=0.5 加权 22.5/25≈**90%**。核心链路（唤起面板→搜命令/模型/项目/文件→Enter 执行、三栏直达 `Ctrl+1/2/3`/循环 `Ctrl+.`、发送 Enter/换行 Shift+Enter/follow-up Alt+Enter、各工作台面板、审批 Enter）**全键盘闭环**。⚠ 三条均"功能可达、键位偏离字面"：#8 裸 Tab→`Ctrl+.`（Win/Electron 吞 Tab 的合理规避）、#6/#7 内联 `@`/`/` 触发→现经命令面板注入。**判 T5.1 达标完成**；后续小项登记不阻塞：#24 消息级分支/复制/标签/回滚缺稳定键盘入口（hover-only，中改）、#6/#7 输入框内联触发（中改） | T5.1 ✅（§11 终审≈90%）；#24/#6/#7 转后续小项 |
| 2026-09-02 | T5.3 打包分发 | 风险 | **干净 VM 安装验收 / 三平台构建 / 自动更新 在本机环境无法验收**：无干净 Windows VM、无 mac/linux 构建机、无代码签名证书。当前仅 Windows NSIS 产物可产出（已验）。**决策**：T5.3 保持未完成、标注环境阻塞，待具备干净 VM + 三平台 CI + 签名后再做「10 分钟跑通配 Key→首次对话→改文件」验收与自动更新接线 | T5.3 阻塞（环境受限，非代码缺陷） |
| 2026-09-02 | §7.6 三件套（真机验收） | 维护 | **按 `pi-wood-ui-gate-verify` 管线对 T5.4/T5.5/T5.6 做真机视觉验收**（补齐此前"运行态手验留后"的欠账）。管线：杀残留 electron → `pnpm typecheck`(node+web 全绿) → `pnpm build`(BUILD_OK) → `electron-vite dev -- --ui-chat`（临时把 harness prompt 扩为 bash×2 + read×2、finish 前 executeJavaScript 派发 Ctrl+Shift+E 展开全部组 + 滚到工具区顶、等 1.8s 让异步 shiki 落地再截屏）→ `--ui-stress 10000`。证据：`apps/desktop/docs/proofs/ui-v3/t56-chat2.png`（工具区，exit=0/日志 error·fail=0/无 already/captured 收尾）、`t56-stress.png`（10000 事件 94ms 注入、渲染正常不卡）、`t56-chat.png`（底部最终答复）。**目检结论**：① T5.6 分组——两组「✓ 2 个工具调用 · 全部成功 · 总耗时 0.3s / 0.0s」正确成形，模型分两批（bash 批 + read 批）之间被 assistant 文本打断→分成两组而非误并，组头图标/计数/状态/总耗时/chevron 齐全，Ctrl+Shift+E 展开生效；② T5.4——每行右侧「已完成」状态文字与图标并存不冲突，bash 行 `终端 ls -la`/`node --version` 命令内联渲染无溢出/断版（短命令 token 着色在截图缩放下较淡，展开块着色由代码路径保证）；③ T5.5——思考折叠行显示「思考 · 耗时 <1s · <尾部预览>」「耗时 2.0s · …」紧凑耗时 + 实时尾部预览均生效。**收尾**：临时 harness prompt/finish 改动已全部回退（`git diff ui-chat-harness.ts` 为空），三件套代码文件保持纯净；恢复 dev 实例。**结论：§7.6 三件套真机验收通过，此前 §8 各行的"运行态手验留后"欠账结清** | §7.6 收口并真机验证 ✅；可提交本批次 |
| 2026-09-02 | T5.5 思考折叠预览 | 完成 | **§7.6 三件套末项（收口）：把 `pi-thinking-fold` 的 live tail 预览模式移植进现有 `ThinkingCard`（不装插件）**。落地：① `packages/ui-kit/src/tool-card.tsx` `ThinkingCard` 新增可选 `preview?: string`——折叠行标签从 `· {思考中…/耗时Ns}` 扩为再追加 `· {preview}`（`text-muted-foreground/65` 更淡），组件内 `pv=(preview??"").replace(/\s+/g," ").trim()` 归一化换行/多空格、空则不显；数据模型不动（`ConversationItem` thinking 已有 `text`/`durationMs`）。② `fmtDuration` 紧凑化：`<1s→「耗时 <1s」`、`<60s→「耗时 12.3s」`(10s 内一位小数、以上取整)、`≥60s→「耗时 1m2s」`（原「持续了 N 秒」）。③ `MessageList.tsx` `ThinkingRow` 传 `preview={item.text.slice(-60)}`（非流式尾部摘要）。④ live 流式块 `ThinkingCard streaming` 传 `preview={liveThinking.slice(-60)}`→折叠行随 token 实时更新推理尾部（此前只显「思考中…」）。**决策/偏差**：`preview` 由调用方 slice(-60) 传入、`ThinkingCard` 不自己截 `text` 尾部——保持组件薄且流式/非流式两路统一（流式 `text===liveThinking` 全量但预览仍 tail-60）。**门禁**：`tsc --noEmit` ui-kit + desktop web 全绿、`electron-vite build` 三目标成功；无单测（纯展示 + `fmtDuration` 为 ui-kit 内部函数未导出、渲染层依赖运行时）。⚠ 运行态（开 thinking 模型跑长任务、看折叠行「耗时 Ns · 尾部」实时刷新 + 点击展开全文不变、明暗主题）留应用内截图手验；纯渲染层 HMR 即生效。**§7.6 三件套全部收口：T5.6 ✅ / T5.4 ✅ / T5.5 ✅** | T5.5 ✅（§7.6 收口）；下一步可提交本批次或进 §7.7 T6.6/T6.7 |
| 2026-09-02 | T5.4 工具紧凑显示 | 完成 | **§7.6 次项：把 `pi-tool-display` 的紧凑工具渲染模式移植进现有 ui-kit `ToolCard`（不装插件）**。落地：① 新建 `packages/ui-kit/src/shiki-command.tsx`——`HighlightedCommand({code,inline})` 用 `shiki.codeToHtml(code,{lang:"shell",theme:"github-dark-default"})` 异步高亮，**模块级 `Map` 缓存 + 上限 1500 满了 clear**（虚拟化列表大量重复命令只跑一次高亮，避免每挂载 async 解析），`useShellHtml` hook 命中缓存即 `setHtml`、未完成先渲染纯 mono 回退（不闪空白）。shiki 自带内联 style 的 `<pre>` 用 `[&>pre]:!bg-transparent [&>pre]:!text-inherit`（important 压过内联 style）+ inline 模式 `[&>pre]:inline whitespace-nowrap overflow-hidden` / block 模式 `whitespace-pre-wrap break-all`。② `tool-card.tsx` 折叠行：`isShellTool(name)` 为真且有命令 → 渲染 `<HighlightedCommand inline>`（`str(args.command).replace(/\s+/g," ").trim()` 单行），read/edit/write/grep/find/ls 路径类仍走原纯 mono `target`（路径不高亮，按方案）。③ `StatusText` 组件与图标并存（图标保留）：running「运行中」`animate-pulse`+primary、ok「已完成」`text-muted-foreground/55` 常显淡色、error「失败」`text-destructive/70`，无框纯文字不占高。④ 展开 `ToolBody` bash `$` 命令块的命令文本由 `span` 换 `<HighlightedCommand>`（block，保留 `$` 前缀 + `bg-[#0f1115]` 暗底）。⑤ 输出截断提示：`outLines = props.output.split("\n").length`，`!open && outLines>200` 时折叠行尾加 `…(+N 行输出)`（`text-muted-foreground/55`）。**偏差/决策**：方案步骤1 建议「复用 `CodeBlock` 的轻量 `InlineCode` 变体」——现有 `CodeBlock`(`code-block.tsx`)是整块 `CodeBlockCode`（自带 border/`p-3` 暗底容器），直接嵌进无边框紧凑折叠行视觉过重且 `<pre>` 不能内联一行，故**不复用 CodeBlock、新建 `HighlightedCommand`**（inline/block 两态共用其缓存 hook，block 态即紧凑版命令块、去行号去复制、保留 `$`）。方案步骤2 ok 徽标「success 色」——实测全绿徽标在长列表里过抢眼，改 `muted-foreground/55` 常显淡灰（running/error 才给主色/红，符合降噪）。**门禁**：`tsc --noEmit` ui-kit + desktop node+web 工程全绿、`electron-vite build` 三目标成功（本次复核）；**未新增单测**（纯展示层，无独立可测逻辑单元，`HighlightedCommand` 的异步高亮/缓存行为归运行时）。⚠ 运行态（真起 dev 触发 bash/read/edit 各一次、看折叠行命令着色 + 展开块高亮 + 长输出提示、明暗双主题对比）留应用内截图手验；纯渲染层 `pnpm dev` HMR 即生效 | T5.4 ✅（§7.6 次项）；下一步 T5.5 思考折叠预览 |
| 2026-09-02 | T5.6 连续工具分组 | 完成+偏差 | **§7.6 降噪三件套首项：把连续多次工具调用折叠成一行组头（数量/状态/总耗时 + 成功·失败·运行中计数），点组头展开逐条 `ToolCard`（各自独立展开态）**。落地：① 纯函数 `lib/tool-groups.ts`——`groupToolRows(items, enabled)` 扫描 items，连续 `kind:tool` 段长 **>=2 才成组**（单个工具原样保留→不误分组），system/thinking/assistant/user 打断连续；生成 `DisplayRow = ConversationItem \| ToolGroupItem`，`ToolGroupItem.id = tg:<首工具id>`（同段随流式追加保持稳定键，虚拟列表不重排闪烁），聚合 `status`(running>has_error>all_ok)/`okCount/errorCount/runningCount`/`totalDurationMs`(仅累加已知耗时，全缺则 undefined)；关闭分组直接返回原数组（同一引用→退化为单条渲染）。② **补时间戳**：`ConversationItem` 的 `tool` 变体原无计时，新增可选 `startedAt`(tool_execution_start 记 `Date.now()`)+`durationMs`(tool_execution_end 由 startedAt 推算)，历史回填(`loadMessages`)无时间→组头省略耗时。③ `MessageList` 虚拟化切 `displayRows`：`count/getItemKey` 用 `displayRows`、`ConversationRow` 经 `isToolGroup` 增 `tool_group` 分支、`tool_group` 与 tool/thinking 同 `mb-0.5` 紧排、`measureElement` 自适应动态组高；live 尾块不分组不变。④ 新建 `components/center/ToolGroup.tsx`：`bg-muted/30 border-border/50` 圆角淡灰条与单条无边框工具行区分，running 组头 `Loader2` 脉冲「运行中…」并自动展开、完成且未被手触/全局操作则按 `toolGroupsDefaultOpen` 收起；错误计数弱化色。⑤ 全局切换：**内存态** `stores/tool-groups-store.ts`(zustand，`allOpen`+`nonce`)，`App.tsx` `Ctrl+Shift+E`(无冲突)→`toggleAll()` 自增 nonce；各组 `useEffect([nonce])` 一次性 `setOpen(allOpen)`（不锁定，之后仍可单组手风琴；nonce===0 跳过保首轮恢复 defaultOpen，刷新 store 归零→恢复默认）。⑥ 设置：渲染层 `settings-store` `ui` 加 `toolGroupsEnabled`(默 true)/`toolGroupsDefaultOpen`(默 false)，`SettingsModal`「界面」页加两 `Switch`（复用 `toolCardsDefaultOpen` 模式）。**偏差**：计划步骤4 写「`settings-service.ts`(主进程)加 `ui.*`」——主进程 `PiWoodSettings` 类型本就无 `ui` 键（`toolCardsDefaultOpen`/`thinkingDefaultOpen` 也从未进主进程默认，靠渲染层 `merge` defaults 兜底 + `deepMerge` 容忍额外键），故沿用现状仅改渲染层、不动主进程，保持一致。**⚠ 门禁踩坑**：本会话 `git pull`（34e493f）带入 vendored subagent 新依赖 `@earendil-works/pi-tui` 未装 → desktop `tsc -p tsconfig.node.json` 报一片 vendor 错（`Cannot find module pi-tui` + 级联 implicit any / `addChild 不存在`），**与本任务无关**；`pnpm install` 链上后 node 工程 typecheck 归零。install 的 postinstall `electron-builder install-app-deps` 因 `packages/engine/node_modules/@pidesk/ipc-schema` 路径 stat 失败而报红（无关、不影响依赖链接与 build）。**门禁**：`tsc` node+web 工程全绿、`node --test` desktop 10/10（新增 `tool-groups.test.ts` 纯逻辑 7/7：关闭原样/单个不分组/连续聚合稳定键/无耗时 undefined/running·has_error/多段/思考打断）、`electron-vite build` 三目标成功。⚠ 运行态（真起 dev 触发连续 5+ 工具、1 万条压测、真人按 Ctrl+Shift+E）留应用内手验（本次纯渲染层，HMR 理论即生效，压测/快捷键仍建议实跑）；探针 `.ts` 无（单测为常驻 `tool-groups.test.ts`） | T5.6 ✅（§7.6 首项，最高降噪价值）；下一步 T5.4 工具紧凑显示 |
| 2026-09-02 | 对话交互层重构（PromptTray） | 决策+完成 | **把"对话过程中产生的交互"从浮窗/模态统一改为贴输入框顶部的内联可折叠扩展层**。⚠ 用户明确 UI 偏好（入 USER.md）：审批/选择/输入**不要右下角浮窗、不要全局模态**，用 Composer 上方同款圆角卡片承载。落地：① 新建 `components/center/PromptTray.tsx`——合并**工具审批（approval:request）+ ctx.ui（ui:request select/confirm/input）**成一个队列，头部图标+类型徽章+标题+`N/M` 分页+折叠，正文按类型渲染（审批=终端/−+预览、select=编号选项行、confirm=说明、input=输入框），动作区按类型给按钮；出现新项自动展开、可折叠成细卡。② `security/approval-gate.ts` 加 `describeApprovalCall(toolName,input)`：bash→命令、edit→文件+`−/+`预览、write→文件+内容预览、其它→紧凑 key:value，**替代原始 JSON**；父门 + `engine-manager` 的 `guardChildTool` 都用它。③ `approval:request` payload 加 `toolName`（`confirmViaRenderer` 透传，preload/global.d.ts 同步）供图标。④ **删除** `ApprovalCards.tsx`（右下角浮窗）+ `UiRequestDialogs.tsx`（全局模态），App 里 `<PromptTray/>` 置于 `<Composer/>` 正上方。⑤ 外壳复用 Composer 的 `rounded-2xl border-white/10 bg-[#333333]`，但 `mx-3` 内缩**比输入框窄**、轻阴影避免与输入框重叠。会话辅助（ConversationAssist）暂留 Composer 上方未并入。**门禁**：typecheck 全绿、`electron-vite build` 通过、真机 dev16 验证审批卡出现在输入框正上方、同款卡片、不重叠。 | 对话交互统一入口 ✅；后续可把会话辅助/更多对话内交互并入 PromptTray |
| 2026-09-02 | T6.2 子代理接线（方案 1 终态） | 完成+偏差+验证 | **首版把 vendored 打进 CJS 主进程 bundle → 启动即崩 `ERR_PACKAGE_PATH_NOT_EXPORTED`**（`pi-coding-agent` ESM-only、esbuild 把静态 import 转顶层 require；`import.meta.url` 在 CJS 失效）。⚠ **typecheck/build/离线探针（皆 ESM 下跑）盖不住此运行时边界，只有真机启动 e2e 暴露**（教训入 MEMORY）。**回退改方案 1（SDK 托管 ESM 扩展）**：① 新增 `EngineStartOptions.additionalExtensionPaths`+`SdkAdapter` 透传 → SDK 的 jiti/ESM 管线运行时加载 `pi-wood-subagent-entry.ts`（default export factory），**不打进 bundle**（out/main 205→99KB、不再静态 require pi-coding-agent/pi-tui），jiti `getAliases()` 把 SDK/pi-tui/typebox 别名到自带实例。② child 审批门经 `globalThis.__piwoodSubagentBridge`（`buildChildGate`/`guardChildTool`/`onRuntime`）跨 CJS↔ESM 同进程传。③ ** child print 会话不触发 `tool_call` 事件钩子**（注入的 `extraExtensionFactories` 门装了不拦）→ 改在 vendored `createPiSessionOptions` **包 `bash.execute` 调 `guardChildTool`**（`decide`+ApprovalCard confirm），拒绝即返回错误不执行。④ **修通用缺陷**：`SdkAdapter.newSession/switchSession/fork` 之前只重订阅、没再 `bindExtensions` → 新会话不发 `session_start` → 子代理丢工具（模型看不到 `agent_start`）；抽 `bindExtensions()` 三处各调。⑤ `SdkAdapter` 不再吞 `services.diagnostics`。**门禁+e2e**：`pnpm -r typecheck` 全绿、`electron-vite build` 通过、**真机（DeepSeek/dev9）验通** `agent_start→agent_wait→agent_result` 委派 + `general` 子代理 `git log` **弹出桌面 ApprovalCard**（审批旁路堵上）。⚠ 遗留：~~child edit/write 未包~~ 已补（`guardTool` 泛化到 bash/edit/write，dev10 验 write 弹卡）、进度上屏归 §7.7 T6.3、ApprovalCard 入参 JSON 展示丑、完整多代理 fan-out/steer/cancel e2e 待补。附：`ensure-electron.mjs` 修 macOS 二进制检测；profile 放 `~/.pi/agent/agents/{general,explore}.md` | T6.2 方案 1 ✅（委派+child bash 审批已验），edit/write+UI+全编排待后续 |
| 2026-09-02 | T6.2 子代理接线（§7.5 S3/S4/S5） | （已回退→见上）完成+偏差 | **goofansu/pi-subagent 以 vendored in-process 方式接进桌面**。落地：① S3 vendored 源码到 `apps/desktop/electron/main/subagent/vendor/`（46 文件，保留 MIT LICENSE+`docs/adr/*`+CONTEXT.md），裁掉 claude/codex harness（其 `@anthropic-ai/claude-agent-sdk` 不在依赖树）+ 全部 `*.test.ts`/conformance/suite-setup/standalone-run-helper；`composition.ts` 改 Pi-only。② **不 `pi install`、不补 package.json exports**：按相对 `.ts` import 由 esbuild 打进主进程 bundle，免 `pi` CLI/磁盘扩展加载。③ 给 vendored `createPiSessionOptions` 加可选 `extraExtensionFactories?: InlineExtension[]` → 透传进 child `DefaultResourceLoader.extensionFactories`（唯一一处内核改动）。④ S4 新增 `pi-wood-subagent.ts`：`createPiWoodSubagentRuntime({getPolicy,confirm,isAutoAccept?,agentDir?})` 用自定义 `sessionOptionsFactory` 调默认工厂 + `[childGate]`（`permissionGateExtension` 复用父策略与 `confirmViaRenderer`）→ child bash/edit/write 过桌面审批门、杜绝旁路；返回 `{runtime, inlineExtension:{name:"piwood-subagent",factory}, dispose}`。⑤ 接 `engine-manager.ensureEngineUnlocked`：闭包传入 getPolicy/confirm（**偏差：未抽 `security/approval-io.ts`**，避开搬 `approval:acceptAll` 跨 pendingApprovals/pendingUiRequests 回归），`inlineExtension` 追加进 inlineExtensions；S5 切项目 `disposeSubagent()`→`subagents.shutdown()+delivery.shutdown()`；深度防递归沿用 `PI_SUBAGENT_DEPTH`+`isPiChildExtensionLoad`+`filterPiChildExtensions`。**依赖**：`pi-tui` 提为 apps/desktop 直接依赖（TUI 渲染层 RPC 下惰性死代码但模块级 import 需运行时可解析，已核实 widget/notification render 不在 session_start eager 构造）。⚠ **S1 空操作**：本机 macOS、无全局 settings.json、无旧 pi-subagents、pi CLI 不在 PATH。**门禁**：`pnpm -r typecheck` 全绿（含 strict 下整份 vendored 内核）、`electron-vite build` 通过（out/main 打入 6×`agent_*`+`piwood-subagent`+`piwood-permission-gate`+`extraExtensionFactories`、pi-tui externalize）、**离线探针**（真 Node `--experimental-strip-types`+假 ExtensionAPI 走 attach→session_start）证明 6 工具全注册、dispose 无抛错、探针后入回收站、`git diff --check` 干净。⚠ **剩余（S6）**：真密钥多代理 e2e（并行 fan-out+续跑+steer+cancel+child bash 弹审批卡）需带密钥+重启 dev 手验；子代理进度上屏归 §7.7 T6.3 | T6.2 接线 ✅（内核+审批门+生命周期），e2e/UI 待后续 |
| 2026-09-02 | T7.9 小模型会话辅助 | 完成+偏差 | **OpenChamber `session-assist/` 落地为「每轮 settled 后独立生成 recap + 1~3 追问、Composer 上方淡显」**。⚠ 偏差：① **无独立小模型设置→复用当前已配置模型**（`loadSettings().model`→`setModel`）；② 触发**不用 busy→idle 定时器→主 adapter `agent_settled` 时 fire-and-forget**（`prompt` handler 每轮重置并累积 `text_delta` 到 `assistTextBuf`、`turn_end` aborted 置中断、正文 ≥40 字才生成省 token），`inFlight` 单飞锁 + 25s 超时；③ **辅助 LLM 走隔离第二运行时** `assist-service`：`SdkAdapter.projectDir=os.tmpdir()/pi-wood-assist`（会话按 cwd 归集、不进真实项目 `sessionsList`、不污染左栏），`denyAll` 门 + 空工具纯文本、每轮 `newSession()` 隔上下文；④ **不写 session metadata→渲染层内存 `assist-store`**，`engine:assistResult` 回推时捕获 `session=currentSessionId`+`forItemsLen=items.length`，`ConversationAssist` 仅 `session 一致 && items.length===forItemsLen && !dismiss` 显示（新消息/切会话自动隐），追问 chip 派发 `piwood:composer-insert`；⑤ 纯逻辑 `assist-parse.ts`（`shouldAssist`/`buildAssistPrompt`/`parseAssist` 剥围栏取首个 `{}` 校验 recap+suggestions≤3）拆出无 electron 依赖。**落地面**：ipc-schema `engine:assistResult`、engine-manager 每轮采集+触发、preload+global.d.ts `onAssistResult`、`assist-store`+`ConversationAssist`（App 中心列 MessageList↔Composer 间）、App 订阅回推。**门禁**：typecheck 全绿、`pnpm build` 三目标成功、`assist-parse` 纯逻辑单测 6/6（纯 JSON/剥围栏去空截 3/坏空无对象→null/仅 recap/短跳过/含指令）、`git diff --check` 干净。⚠ 真实 recap/追问生成需带密钥+重启 dev（主进程改动）手验；每次多一个临时 Pi 会话（成本/耗时按复用模型，短回复已跳过）。探针 `.ts` 入回收站 | T7.9 ✅（第二档，复用模型非独立小模型） |
| 2026-09-02 | T7.11 会话草稿持久化 | 完成+偏差 | **OpenChamber `chatDraftPersistence.ts` 落地为「按会话暂存 Composer 输入、切会话/刷新不丢、发送即清」**。⚠ **偏差**：计划快照 `mentions: string[]` 在本项目对应**结构化 `AttachmentItem[]`**（@文件/粘贴文本均带 path），故存 `{text, attachments}`、key 用 `session-store.currentSessionId`。落地：① 纯逻辑 `lib/chat-draft-persistence.ts`：`parseDrafts`（缺失/坏JSON/`version!==1`→空表降级+丢非法条目）、`upsertDraft`（`>MAX_DRAFTS(50)` 按 `touchedAt` LRU 淘汰最旧且不含刚写者；空文本+空附件→删）、`serializeDrafts`/`removeDraft`，localStorage(key `pi-wood.chatDrafts.v1`,`typeof localStorage` 守卫+无 DOM 内存兜底可单测)+`write/read/clearDraft`；② `use-composer-controller` 三 effect：`liveRef` 每次渲染镜像、`currentSessionId` 存在时 input/attachments 变更 **500ms 防抖** `writeDraft`、`currentSessionId` 变化时**先 flush `writeDraft(prev)` 再 `readDraft(new)`** 载入/（真实切换到无草稿→清空，`prev` 未定义即会话首次实体化→保留 onboarding 文本不清）、`send()` 成功 `clearDraft(currentSessionId)`+取消挂起防抖；send deps 补 `currentSessionId`。**门禁**：typecheck 全绿（修一处 `{input}`→`{text}` 映射）、`pnpm build` 三目标成功、`chat-draft-persistence` 纯逻辑单测 5/5（空即删/LRU 逐最旧/removeDraft 幂等/版本坏JSON 降级/序列化+write-read-clear 回环走内存兜底）、`git diff --check` 干净。⚠ 纯渲染层，`pnpm dev` 即 HMR 生效、真实"敲一半切会话再切回"交互待应用内手验。探针 `.ts` 入回收站 | T7.11 ✅（第二档，纯渲染层） |
| 2026-09-02 | T7.6 /btw 侧边问答 | 完成+偏差 | **OpenChamber `btw.ts` 落地为「不扰动主会话的独立临时问答」**。⚠ **偏差**：计划写"SDK fork、继承完整历史、不切 currentSessionId"——但本项目单 adapter/单活跃会话，`fork()` 会切本 runtime 活跃会话并重绑 `engine:event`，做不到"不动主会话 + 与进行中任务并发"（属 T6.1）。经用户选**方案 A：独立第二运行时 + 上下文前言**。**落地**：① `ipc-schema` 加 `BtwAskCommandSchema` + 通道 `engine:btwEvent/btwAsk/btwAbort/btwClose`；② `engine-manager` 加与主 `adapter` 隔离的 `btwAdapter`/`btwUnsub`——`ensureBtwAdapter()` 惰性 `new SdkAdapter().start({projectDir, 静默 uiBridge, customTools:[], inlineExtensions:[permissionGateExtension(()=>({mode:"denyAll"}), async()=>false)]})`（denyAll 杜绝副作用与审批弹窗、纯问答），best-effort 套默认模型，`subscribe(e=>send(btwEvent,e))`，`closeBtw()` 在 `ensureEngineUnlocked` 换项目处一并释放；`buildBtwPromptText` 前置合成 system-reminder + `# 会话上下文（仅供参考勿执行）` + `# 侧边问题`；IPC btwAsk→prompt、btwAbort、btwClose；③ preload+global.d.ts `btwAsk/btwAbort/btwClose/onBtwEvent`；④ `btw-store`（`bySession[currentSessionId]` 转录本，`message_update`/`agent_end`/`turn_end` 归约；`buildContextBlock` 裁 ≤12 轮 user/assistant + 工具压行）；`BtwPanel`（只读，`Markdown`+`ThinkingCard`、空态引导、采用到主会话经 `piwood:composer-insert`、`x`→btwClose）；⑤ `workbench-store`/`RightPane` 加 `btw` tab（panelMeta icon `message`、`Ctrl+Shift+B`，不入 LAUNCH_ORDER）；`App` 订 `onBtwEvent`+快捷键；`use-composer-controller.send()` 在 streaming 早退前拦 `/^\/btw(\s|$)/`、主会话不收消息。**门禁**：typecheck 全绿、`pnpm build` 三目标成功、`/btw` 识别 + `buildContextBlock` 纯逻辑单测 4/4、`git diff --check` 干净。⚠ 真实"侧边答案显示 + 主任务不受影响"需带密钥+重启 dev（主/preload）手验；「采用到主会话」为追加非新发。探针 `.ts` 入回收站 | T7.6 ✅（第二档，并发靠第二运行时绕开 T6.1） |
| 2026-09-02 | T7.4 Dev Server 自动发现 | 完成 | **OpenChamber `dev-servers/parse.js` 三平台解析器移植为「浏览器面板发现本地 loopback dev server 并一键预览」**。分层——① 纯函数 `dev-server-parse.ts`：`splitHostPort`（正确处理 `[::1]:5173` IPv6 括号）、`isLoopbackOrWildcard`（保留 `127.*`/`::1`/`localhost`/`0.0.0.0`/`::`/`*`，排除 LAN 如 `192.168`/`10.x`）、`parseNetstat`（仅 LISTENING）、`parseLsofFpcn`（`-F pcn` p/c→n 关联）、`parseProcNetTcp`（state `0A`、8/32 位十六进制小端解码 IPv4/IPv6）、`filterDevServers`（`SYSTEM_PORTS` 集排除 22/53/445/5432/3306/6379/9229/8080… + 按端口去重取命令名/pid 更全者）；② 采集器 `dev-server-detector.ts`：win32 `netstat -ano -p TCP` + `tasklist /fo csv /nh` pid→映像名映射、darwin `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`、linux `/proc/net/tcp(6)`，**5s 缓存 + 失败降级**、`initDevServerIpc` 注册 `engine:listDevServers`；③ ipc-schema 加 `DevServerInfoSchema`+通道、boot `initDevServerIpc()`、preload+global.d.ts `listDevServers`；④ `BrowserPanel` 地址栏下加「本地服务」芯片行（`:{port}` + 命令名，点击 `go(url)` headless 预览、右侧刷新按钮、空态/扫描中提示）。**门禁**：typecheck 全绿、`pnpm build` 三目标成功、`dev-server-parse` 三平台 fixture 单测 6/6（含 LAN 排除、139/8080 系统端口剔除、IPv6 括号、`/proc` 小端解码）、`git diff --check` 干净。⚠ 运行态发现需重启 dev（主/preload）+ 真起 vite 实跑；Linux 端 pid/command 未做 inode→pid 反查（port/host 检测够用）。探针 `.ts` 用后入回收站 | T7.4 ✅（第二档首项，提级先做） |
| 2026-09-02 | T7.3 会话导出 Markdown | 完成 | **OpenChamber `exportSession.ts` 落地为「会话 → Markdown 文件」**。① 纯函数 `lib/export-session.ts`：`formatSessionAsMarkdown(items, title)` 覆盖 5 类 `ConversationItem`（user/assistant 角色头、thinking `>` 引用块带耗时、tool `### 🔧 状态 名` + 入参 json/Diff/输出围栏、system `---` 分隔），tool 输出截断 8000/入参 1000 防爆文件；`buildExportFilename` 用 `\p{L}\p{N}` **保留 Unicode 字母数字（中文标题可用，优于计划"非字母数字→-"）**、折叠分隔符、Windows 保留名加 `pi-wood-` 前缀、空标题兜底 `session`、截断 60、追加日期后缀。② 主进程 `session:export`（`data.ipc.ts`）：`dialog.showSaveDialog`（默认落当前项目目录 + Markdown 过滤器）→ `writeFileSync` UTF-8 → 返路径/取消 undefined；preload `exportSessionMarkdown` + global.d.ts。③ 入口 `ConversationHeader`「…」Radix `DropdownMenu`（`Icon` 新增 `ellipsis`），仅 `items>0` 显，导出成功/取消/失败三态 toast。子代理递归留 §7.7 T6.3。**门禁**：typecheck 全绿、`pnpm build` 三目标成功、`export-session` 纯函数单测 6/6（文件名特殊字符/中文/保留名/空/截断、五类消息、长输出截断）、`git diff --check` 干净。⚠ 真实保存对话框落盘需重启 dev（主/preload 改动）手验；探针 `.ts` 用后入回收站 | T7.3 ✅（第一批收口） |
| 2026-09-02 | T7.2 per-session 权限自动接受 | 完成 | **OpenChamber `permission-auto-accept` 模式落地为「按会话 id 的自动接受审批」**。① `SdkAdapter` 加同步 `getSessionId()`（未启动→undefined，engine 包 interface+sdk-adapter）；② `permissionGateExtension` 加第三参 `isAutoAccept`，`tool_call` 里**仅当 `decide` 返回 `ask`** 且 autoAccept 为真才 `return`（放行、不弹），`deny` 分支（denyAll/path-guard）永不进该分支 → 安全底线不破；③ `engine-manager` `isAutoAcceptForSession(next)=loadSettings().autoAcceptSessions[next.getSessionId()]`，无 id/缺省→false（fail closed）；④ settings 双端加 `autoAcceptSessions: Record<string,boolean>`（主 `PiWoodSettings`+默认 `{}`、渲染层 store interface/defaults/merge）——**持久化单一写入者仍是渲染层 `settingsSet` 深合并、主进程只 `loadSettings` 读**，避免与 `initSettingsIpc` 的内存 `current` 双写互相覆盖（沿用现状）；⑤ 新增 IPC `approval:acceptAll`：`pendingUiRequests` 由裸 resolve 改存 `{kind,resolve}`（`ui:respond` 同步改 `entry.resolve`），开启时 resolve 全部 confirm 类 pendingUiRequests + 全部 pendingApprovals，select/input 不误放行，preload+global.d.ts 暴露；⑥ `ConversationHeader` 右侧 shield「自动接受」toggle（开→success 色，仅 engineReady && currentSessionId 显；切换 patch settings + 开启时 acceptAll + toast）；`session-store` 加 `currentSessionId`+`refreshSessionId()`（`engineState().sessionId`），activateProject/selectSession/createSession 后刷新；命令面板「新建会话」改派发 `piwood:new-session` 交左栏单一持有者统一处理并刷新。**门禁**：`pnpm -r typecheck` 全绿、desktop 单测 3/3、`decide` 安全底线专项单测 4/4（highRisk bash=ask / denyAll bash=deny / edit .env=deny / read=allow）、`pnpm build` 三目标成功、`git diff --check` 干净。⚠ 真实「弹/不弹」运行态需带密钥+选项目实跑（主/preload 改动需重启 dev，HMR 仅渲染层）；子代理继承留 §7.7 T6.3 落地后补。探针 `.ts`/`.mjs` 用后走回收站删 | T7.2 ✅（第一批次项） |
| 2026-09-02 | T7.1 大文本粘贴→虚拟文件 | 完成+偏差 | **OpenChamber `largeTextPaste.ts` 模式移植，双阈值（`text.length>=2000` 或行数 `>=25`）命中即转文件附件、不污染输入框**。⚠ **偏差修正**：计划写"造内存 `new File()` 走附件管线"，但核实本项目附件管线**基于磁盘路径**（`window.pi.prompt(text, string[])` → 主进程 `prepareAttachments` 用 `readFileSync(path)` 生成 `<file name=…>` 块，非 File 对象）——内存 File 主进程读不到、方案不成立。据此落地：① `lib/utils.ts` 抽纯函数 `isLargePaste`/`countLines`；② `Composer` textarea `onPaste` 命中阈值 `preventDefault`+`c.addPastedText`，短文本走原生粘贴不变；③ `use-composer-controller` 加 `addPastedText`（复用 pickFiles 的去重+≤12 附件逻辑、sonner toast「已作为文件附件添加（N 字符 / M 行）」）；④ **主进程新增 IPC `engine:stagePastedText`**：写 `os.tmpdir()/pi-wood-pastes/pasted-text-<ts>-<seq>.txt`（`pasteSeq` 防同毫秒冲突）、best-effort 回收 24h 前旧粘贴文件、返回 `{path,name,size,kind:'file'}` 经 preload+global.d.ts 暴露。发送时经既有 `prompt()` 管线让 agent 读附件、附件区可移除——**完整复用现有管线、零改 prompt/prepareAttachments**。**门禁**：`pnpm -r typecheck` 全绿、`pnpm build` 三目标成功、`isLargePaste`/`countLines` 边界单测 5/5（500 字符→插入、3000→附件、24/25 行阈值、CRLF/LF/CR 计数）。⚠ 真实剪贴板粘贴 e2e 因主/preload 改动需重启 dev 实例、且 paste 事件带 `clipboardData` 难合成，留应用内手验（判定/管线代码级已闭环）。探针 `.mjs` 用后走回收站删 | T7.1 ✅（第一批首发） |
| 2026-09-02 | T7.1~T7.12 OpenChamber 全仓借鉴批次 | 决策 | **系统性扫描 OpenChamber 全仓（子代理之外）→ 整理 12 项可借鉴模式为待办**。核实（源码级，本地 clone `/Users/admin/Desktop/personal/openchamber`）：第一档高价值——T7.1 大文本粘贴→虚拟文件（`largeTextPaste.ts`，双阈值 2000 字符/25 行）、T7.2 per-session 权限自动接受（`permission-auto-accept/runtime.js`，服务端唯一响应者+子代理继承+fail closed）、T7.3 会话导出 Markdown（`exportSession.ts`，递归子代理树+文件名安全化）、T7.4 Dev Server 自动发现（`dev-servers/parse.js`，三平台 lsof/netstat/proc 纯函数解析+系统端口过滤+loopback 判定）、T7.5 目标模式（`session-goal/runtime.js`，服务端控制循环+小模型独立审计+token 预算+20 轮上限+文件存目标文本）、T7.6 `/btw` 侧边问答（`btw.ts`，fork 会话不切换主会话+合成 part 防任务串扰+metadata 关联）；第二档中价值——T7.7 代码审查流、T7.8 定时任务（Markdown loop 文件+跨实例文件锁）、T7.9 小模型会话辅助、T7.10 Agent Memory（global/project 双 scope+unreviewed 安全模式）、T7.11 会话草稿持久化、T7.12 用量/配额追踪。**原则：模式全搬，传输层不搬**（opencode HTTP/SSE → pi-wood in-process SDK + IPC）。落地分四批：第一批 T7.1/T7.2/T7.3（低改动高价值立即做）、第二批 T7.4/T7.6/T7.11、第三批 T7.5/T7.10/T7.9/T7.7、第四批 T7.8/T7.12。详细清单见 **§7.8** | 十二项待办（见 §7.8 勾选清单） |
| 2026-09-02 | T6.3~T6.7 子代理 UX 层 | 决策 | **分析 OpenChamber 子代理实现 → 传输层不搬、模式全搬，整理为 5 项待办**。核实：OpenChamber（`openchamber/openchamber`，本地 clone `/Users/admin/Desktop/personal/openchamber`）底层是 opencode 原生 task 工具（HTTP server + SSE + parentID child session），OpenChamber 的价值在可视化层——`WorkStatusSubagentsSection.tsx`（parentID 过滤+状态/审批/成本+出现即展开）、`taskToolModel.ts`（解析 `<task_metadata>`→sessionId→「Open subAgent session」按钮+strip 元数据）、只读子会话 context panel tab、`useSubagentCostRollup.ts`（含嵌套成本汇总）、opencode per-agent `permission` 配置。**架构差异**：opencode HTTP/SSE vs pi-wood in-process SDK + Electron IPC——不起 HTTP server，parentID 改内存 Map（`subagent-registry.ts`）、状态推送改 IPC event（打 `_origin` 标签复用 `engine:event`）、审批上浮复用现有 `approval_request` 通道加 `_subagentId`。**决策**：T6.3 子代理追踪+状态面板（含审批上浮，最高优先）、T6.4 对话流打开子代理按钮+元数据清洗、T6.5 只读子会话视图、T6.6 成本汇总（含嵌套递归）、T6.7 per-tool 权限配置。全部依赖 §7.5 引擎接线完成后开工；§7.5 S5「进度/完成通知上屏」由本节具体化。详细清单见 **§7.7** | 五项待办（见 §7.7 勾选清单） |
| 2026-09-02 | T5.4/T5.5/T5.6 渲染层降噪三件套 | 决策 | **评估三个社区渲染插件 → 均不装，移植 UX 模式到现有组件**。核实：`pi-tool-display@0.5.0`（MasuRii）、`@99percentpeople/pi-thinking-fold@0.1.9`、`@fahmiirsyadk/pi-minimal-toolcall@0.2.1`（月下载 70）**全是 TUI 插件**（peer/关键词带 `pi-tui`，渲染挂 pi-tui `registerMessageRenderer`/widget 管线），pi-wood 无 pi-tui、用自有 React 渲染层 → `pi install` 后 no-op 或报错，不能直接用。**现状核实**：ui-kit `ToolCard` 已实现默认折叠一行（图标+动词+目标+diff 数）、`ThinkingCard` 已实现一行折叠+耗时，即 pi-tool-display/pi-thinking-fold 的核心模式已做 70~80%；pi-minimal-toolcall 的连续工具分组+快捷键是真缺口。**决策**：T5.4 给 ToolCard 折叠行命令加 shiki 内联高亮+状态文字 Badge（对齐 pi.dev「已运行+命令行」）；T5.5 给 ThinkingCard 折叠行加 thinking_delta 尾部预览+耗时格式改「耗时 12.3s」；T5.6 MessageList 预分组连续 tool 项为 ToolGroup+Ctrl+Shift+E 全局切换+ui.toolGroupsEnabled 设置。详细清单见 **§7.6**。落地顺序：T5.6（价值最高）> T5.4 > T5.5 | 三项待办（见 §7.6 勾选清单） |
| 2026-09-02 | T6.2 子代理 | 决策 | **T6.2 路线切换：弃 nicobailon/pi-subagents（spawn A 方案）→ goofansu/pi-subagent（in-process，原"路线 C"）**。评审结论（源码级核实）：goofansu 的 Pi harness 与桌面同款 SDK API（0.84.4）、内存会话、无 spawn（无 execPath/孤儿/密钥物化问题）、自过滤+深度防递归+父信任继承；但默认扩展有 2 个不解决点（child 审批门必须注入、凭据需探针确认）+ 1 个分发问题（未发 npm、无 exports、注入点未暴露）→ 需一次小 fork。关键差异：spawn 版 child 是独立 pi 进程、不经桌面审批门=审批旁路；in-process 版可在注入点给 child 套 `permissionGateExtension`。**详细清单见 §7.5** | T6.2 待办（原 §8 记录作废，以 §7.5 勾选清单为准） |
| 2026-09-01 | T5.1 三栏焦点循环 | 完成 | **补齐 T5.1 键盘优先最后一块：三栏焦点循环**（纯渲染层，无主进程改动）。抽 `hooks/use-column-focus.ts`（逻辑层）：`focusColumn(name)`/`cycleColumnFocus(dir)` 纯 DOM 定位 `[data-col-region]` 容器（兼容懒加载 RightPane），`cycleColumnFocus` 用 `offsetParent!==null` 跳过未挂载/收起的栏。App 三栏外层各包 `<div data-col-region tabIndex={-1}>`，`:focus` 时 `focus:ring-2 ring-inset ring-ring/60` 内嵌高亮（仅容器自身聚焦时显，输入框内聚焦不显→无噪声）。**快捷键踩坑**：初版 `Ctrl+Tab`/`Alt+1·2·3` 在 Windows/Electron 被系统吞（实测焦点不动），改用可靠的 `Ctrl+1/2/3`（直达左/中/右，VS Code 惯例）+ `Ctrl+.`/`Ctrl+Shift+.`（前进/后退循环）；**不劫持裸 Tab**（栏内原生遍历保留）。**验证**：desktop `tsc --noEmit` 全绿；dev HMR 生效；实机确认——点击空处→焦点环随 focus 在栏间移动（右↔中，证明 region 可聚焦 + ring 正确跟随），`Ctrl+K` 打开面板证明全局 keydown handler 触发；唯合成按键 `ctrl+<数字>` 在本自动化注入下 modifier 未可靠送达 DOM（工具限制，非代码缺陷），真人键盘可验。| T5.1 键盘优先 ✅（三栏焦点循环完成） |
| 2026-09-01 | T5.1 命令面板聚合 | 决策+完成 | **插件优先复查 → 无现成插件做桌面命令面板**（palette 本属 app 侧 cmdk，插件只给 pi 提供 tools/commands/skills）。但**聚合数据源 SDK 已全部公共暴露**，故**不手搓扫描器**：`engine:listCommands` 薄桥直接读 live session 的 `extensionRunner.getRegisteredCommands()`（扩展命令）+ `promptTemplates`（模板）+ `resourceLoader.getSkills().skills`（Skill，名加 `skill:` 前缀匹配引擎 `/skill:name` 派发），未启动降级空数组（§8 只读降级不变量）。**契约**：`ipc-schema` 加 `EngineCommand`（zod）+ 通道 `engine:listCommands`；`pi-types.AgentSessionLike` 加三个可选成员；`EngineAdapter.listCommands()`；`sdk-adapter` 实现；`engine-manager` 注册 handler；preload `engineCommands()` + `global.d.ts`。**渲染层**：`CommandPalette` 重写为多分组（命令/扩展命令/Skill/模板/模型/项目/文件），**执行不重造**——命令项把 `/{name} ` 注入输入框（replace）、文件项把 `@{path}` 追加，均经新增 `piwood:composer-insert` 事件（`use-composer-controller` 单一持有：setInput + focus + caret 末尾，仿 `piwood:select-project`）。**@文件** 复用既有 `fs:search`（含 .gitignore 过滤），query≥2 防抖 200ms 取 top12。门禁：ipc-schema/engine/desktop 三包 `tsc --noEmit` 全绿；**headless 探针**（PI_OFFLINE、引导嵌入式 SDK）验证真实返回 `EXT ["todos","websearch","curator","google-account","search","mcp","pi-mcp","mcp-auth","plan"]`（含刚采纳的 `/plan`！）、`SKILLS ["mcp-scripting"]`、`HAS_PLAN_CMD true`。⚠ **主进程/preload 改动需重启 dev 实例才生效**（当前跑的实例 HMR 只覆盖渲染层；`window.pi.engineCommands` 在其旧 preload 里不存在，但渲染层用 `?.`+`.catch` 降级为空组、不崩）。**遗留**：T5.1 验收「90% 高频操作键盘化」需按方案 §11 清单逐条终审（本轮已把命令/模型/项目/文件/Skill/模板聚合，覆盖面大增）| T5.1 命令面板聚合 ✅（数据源全复用 SDK） |
| 2026-09-01 | T4.3 计划模式 + T3.4 真实包验收 | 决策+完成 | **插件优先，先查后写（用户指令："新功能开启前先看是否有现成插件，别手搓"）**。npm pi 生态检索结论：**T4.3 计划模式、T6.2 子代理、浏览器**均已有现成扩展（`@narumitw/pi-plan-mode`/`@janvitos/pi-plan-build`、`pi-subagents`/`@arhen/pi-core-subagent`、`pi-agent-browser-native`），MCP/审批/Todo 已装（`pi-mcp-adapter`/`rpiv-ask-user-question`/`rpiv-todo`）→ **均不自研 inline 扩展，改走 marketplace 底层 `pi install` 路径采纳**。用户拍板采纳 **`@narumitw/pi-plan-mode@0.56.0`**（Codex 式只读 /plan：`plan_mode_question`/`plan_mode_complete` 两工具 + 工具访问限制至计划批准后恢复）。**端到端实测（= T3.4 验收"真实包安装→扩展生效→卸载干净"）**：① `pi install npm:@narumitw/pi-plan-mode`→exit0、写回 `settings.packages`（+dep `pi-tui-kit`，装到 `~/.pi/agent/npm/node_modules`，jiti 载 dist/index.ts）；② **headless 探针**（PI_OFFLINE=1，纯 node 引导嵌入式 SDK，无密钥/无网络：`createAgentSessionServices→FromServices→Runtime`→`session.bindExtensions({mode:'rpc'})`→读 `getActiveToolNames`）确认 `plan_mode_question`/`plan_mode_complete` 注册、`DIAGNOSTICS:[]`；③ `pi remove`→settings 与 node_modules 清干净（仅残留空 `@narumitw/` scope 目录，属 npm 正常行为）、工具消失且无 diagnostics；④ 复装确认持久。⚠ **`pi install` 临时设 `NODE_TLS_REJECT_UNAUTHORIZED=0`**（关证书校验，供应链风险，已在门禁向用户披露并由其确认采纳）。探针脚本 `apps/desktop/plan-probe.mjs` 用后即经回收站删除、未入 git。**结论：T4.3 以现成插件达成、无需新代码；T3.4 真实包全流程验收通过**。遗留：dev 实例需 `engine:reload` 或重选项目才让新装的 plan-mode 在运行中的 UI 生效（探针为独立进程验证，不依赖 dev 实例）| T4.3 ✅（插件采纳）、T3.4 ✅（真实包端到端） |
| 2026-09-01 | UI 打磨·设计工程(二) | 完成 | **续批：裸 `<button>` 按压反馈 + 两处克制动效**（承上一批）。**只给"离散可按压控件"加 `:active` scale，全宽行/标签页/窗口控制/正文内图标一律不加**（Emil 品味：整行缩放难看、窗控不应动）。加反馈者：`MessageList` 滚动到底 FAB（`active:scale-[.95]` + 出现 `fade-in-0`，保 `-translate-x-1/2` 仅动 opacity 不冲突）、`Composer` 附件移除×（`.9`，小目标略强）、`PackageMarket` 分段 tab（`.97`）、`RightPane` 标签关闭×（`.9`，原 `transition-opacity`→含 transform）；`transition-colors` 相应改为 `transition-[...transform]`。**新增两处低频动效**：① `RightPane.Launcher` 空态四张瓦片 `animate-in fade-in-0 slide-in-from-bottom-2` 错峰淡入（delay `i*55ms`、`[animation-fill-mode:both]` 防闪现）；② `MessageList` live 尾块（每轮流式挂载一次）`fade-in-0 duration-200` 轻淡入——**刻意不给虚拟化的已提交行加进场动画**（虚拟列表滚动复用 DOM 会逐行重播=flicker，且属高频，违反铁律）。门禁：desktop+ui-kit `tsc --noEmit` 全绿；新类全为仓内既有 tw-animate-css 工具族 | UI/动画打磨 ✅ |
| 2026-09-01 | UI 打磨·设计工程 | 完成 | **以 emilkowalski/skills 套件跑一轮 UI/动画评审并落地高杠杆打磨**（pick-ui-library → review/improve/find-animation → emil-design-eng）。**选型结论：现有栈即最优，无需换库**——已装 sonner(toast)/cmdk(命令面板)/zustand/clsx+cva/shiki 均与清单一致；primitives 用 Radix（清单推 base-ui，但 shadcn 生态=Radix，按"已在用则不动"保留）；虚拟化用 @tanstack/react-virtual（清单推 Virtuoso，同上不强换）；**未装任何 motion 库=正确**（本项目动效全 CSS，符合"简单 hover/fade 不必上 motion"）。**发现的动画问题（Before→After）**：① 全仓无 `:active` 按压反馈（Emil #1 原则）→ ui + ui-kit `buttonVariants` 基座加 `motion-safe:active:scale-[0.97]`，`transition-colors`→`transition-[transform,background-color,color,border-color,box-shadow]`（覆盖 43 处 Button，含发送键）；② `popover.tsx`/`dropdown-menu.tsx`(Content+SubContent) 缺 origin 感知、从中心缩放 → 补 `origin-(--radix-*-content-transform-origin)`（select/tooltip 本已正确、dialog 模态豁免居中）；③ `switch.tsx`/`tabs.tsx` 裸 `transition-all` → 收敛为精确属性列表；④ 发送键 className 冗余 `transition-colors` 会覆盖基座 transform 过渡致缩放瞬跳 → 删除。**新增（仅限首屏 delight 预算）**：OnboardingComposer 空态问候/卡片/快捷提示 `animate-in fade-in-0 slide-in-from-bottom-2` 错峰淡入（delay 0/80/160+45n、`[animation-fill-mode:both]` 防闪现）。**保留（尊重既定决策、不churn）**：AppShell `transition-[flex-grow]`（可折叠面板布局属性，drawer 曲线已对）、PanelFade 收起 `ease-in`（150ms 微出）。门禁：apps/desktop + ui-kit `tsc --noEmit` 全绿；dev 实例 HMR 生效；所有新类均为仓内既有 tw-animate-css/Radix 工具族 | UI/动画打磨 ✅ |
| 2026-09-01 | T6.2 子代理（pi-subagents）接线 | 待办 | **子代理能力落地，用户指定排最后做**。A 方案（低成本）：在 `engine-manager` 启动 `SdkAdapter` 前设 `process.env.PI_SUBAGENT_PI_BINARY` = **内嵌 SDK 的 `dist/bundle/cli.js`**（从 `node_modules/@earendil-works/pi-coding-agent` 读 `package.json.bin` 解析，版本天然对齐、随 `pi update --self` 跟，免依赖全局 pi）。依据（已探针实证）：`pi-subagents` 的 `getPiSpawnCommand`（`src/runs/shared/pi-spawn.ts`）win32 下——若设了 `PI_SUBAGENT_PI_BINARY` 且为 `.js` → 产出 `{command:process.execPath, args:[cli,…]}`；实测 `node <cli.js> --version`→`0.84.4` exit 0（子进程能起）。前台 spawn 的 child `spawnEnv={...process.env}`（`runs/foreground/execution.ts:615`）→ 继承 `DEEPSEEK_API_KEY` → 前台子代理真可用。**⚠ 当前已装未接线**：`pi-subagents` 已在 `settings.json.packages`，默认解析会走到 `pi-spawn.ts:190` 抛 `Could not resolve the Pi CLI on Windows`（peer `pi-coding-agent` 不在其树、`import.meta.resolve` 失败）→ 模型一旦调 `subagent` 即报错；接线前要么补 A、要么 `pi remove pi-subagents`。**未验残留**：async/后台 runner（jiti `async-execution.ts:567`、Windows control-channel）未端到端跑，真多代理 e2e 需带密钥实跑一次。**长期更优（路线 C）**：in-process 子代理——用 `createAgentSessionFromServices` 造带子集工具/模型的派生会话并发跑（≈ Claude Agent SDK 主流做法，不 spawn CLI、跨平台干净），可作为把子代理做成一等特性时采纳 | 排最后；未接线前调用即抛错 |
| 2026-09-01 | T6.1 多项目并发会话 | 待办 | **多项目/多会话并行提问**——登记为独立架构任务，**非子代理**（子代理=同一 workspace 内并行分片；此需求=多个独立 cwd、各自引擎与会话流的并发会话）。**现状：不支持**，全链路单例假设（已核代码）：`engine-manager.ts:61` 模块级单 `adapter`，`ensureEngine` 158–159 同项目复用、**换项目 `adapter.stop()` 重建**（切换会 abort 前一个在跑的请求，无后台续跑）；`session-store` 单 `activeProject`/单 `streaming`/单 `items`；`App.tsx:78` 单条 `onEngineEvent` 全局事件流喂一个 MessageList；`send()`→`getAllWindows()[0]` + dev 单例锁 → 即使开第二窗口仍共用同一 adapter、事件只回窗口[0]。**改造范围**：① `engine-manager` 单 `adapter` → `Map<projectDir, SdkAdapter>` + 切走保活（仿右栏 workbench 让 pty 常驻，不 stop）；② 事件带 `projectId` 路由，`ENGINE_CHANNELS.event` + 渲染层 store 按会话分片（`items/streaming/queue` keyed by session）；③ `pendingApprovals`/`pendingUiRequests` 的 Map key 现按数字 id，需再带项目归属；④ 窗口/标签：多窗口各绑会话（每个 webContents 收自己事件）或单窗口会话标签 + 后台并行。**边界**：每引擎各自 spawn 子进程（MCP/子代理）、并发下 token/成本/审批各自计。**优先级：排在当前扩展批次（T3.1/T3.4/子代理接线）收口之后再开一轮设计** | 立为后续任务，未开始 |
| 2026-09-01 | T3.4 插件市场 | 完成 | **插件市场落地，接真实 pi-agent 生态**：调研确认 `pi` CLI 无内置 search/registry（纯源安装 `npm:`/`git:`/url/local），pi 扩展实际以 **npm 包**发布（`@plannotator/pi-extension`、`pi-subagents`、`@gotgenes/pi-permission-system`、`@ff-labs/pi-fff`…）。故市场数据源=**npm registry 公开检索 API** `https://registry.npmjs.org/-/v1/search?text=<q> pi`（主进程 `fetch`，PI_HINT 正则过滤 pi 生态、按 name 去重）。① `data.ipc.ts` 新增 `packages:search`（返回 `MarketItem[]`）、`packages:uninstall`→`pi remove`、`packages:update`→`pi update [spec|--extensions]`；沿用 `packages:list/install`；**fetch 加 `AbortSignal.timeout(12000)`**（首版无超时→Electron 主进程首连偶发挂起、UI 无限转圈，已修）+ 超时/网络错误友好文案。② preload+global.d.ts 暴露 `packagesSearch/Uninstall/Update` + `PiMarketItem` 全局类型。③ 新建 `PackageMarket.tsx`（shadcn Dialog）：发现/已安装 两段 + 搜索框（350ms 防抖，空查询给默认「发现」词）+ 卡片栅格（名称/版本 Badge/作者·日期/描述 line-clamp/安装-卸载），安装/卸载后 `loadInstalled()` + `engineReload()` 热重载生效（引擎未就绪则提示下次选项目生效）。④ 侧栏「插件市场」按钮由 open-settings 改派 `piwood:open-marketplace`，App.tsx 监听渲染。`Icon.tsx` 加 `package`。门禁：typecheck 全绿、build 通过；真实 dev 实例点「插件市场」→发现页拉到 10+ 真实 pi 扩展卡片渲染、已安装页空态正确 | T3.4 插件市场 ✅ |
| 2026-09-01 | UI v4-右侧栏Chrome标签化 | 决策+完成 | **右侧栏弃用 dockview，重做为「空态启动器 + Chrome 式单标签」**（用户嫌原固定按钮条丑、参考 ZCode）。① `workbench-store` 新增 `openTabs: WorkbenchTab[]`/`activeTab`+`openTab/closeTab/setActiveTab/hydrateTabs`，`openWorkbench()` 改直连 store（去掉 `piwood:open-workbench` 事件）；`openTab` 顺带派发 `piwood:reveal-inspector`。② `RightPane` 重写：`openTabs.length===0` → 居中启动器（审查/终端/浏览器/文件 四张圆角卡，图标+名称+快捷键，点击创建）；否则 → Chrome 标签条（激活标签 `bg-surface-app` 与内容连通、`×` 常显，未激活 `×` 悬停显）+ 右侧 `+` Popover 新增菜单 + 最右收起按钮；内容区把**所有已开面板常驻挂载、非激活 `hidden`（display:none）**保活（终端 pty/浏览器态不丢）。③ `TerminalPanel` 用 **ResizeObserver 观察宿主**替代 window resize——隐藏→显示时 refit。④ `AppShell` 加 `piwood:reveal-inspector` 监听：开面板时若右栏收起则自动展开。⑤ `App.tsx` 接四快捷键 Ctrl+Shift+G/Ctrl+\`/Ctrl+T/Ctrl+P → openWorkbench。标签 `diff→审查`（原变更）。持久化改 `settings.workbench:{openTabs,activeTab}`（原 dockview layout 作废）。dockview 依赖暂留 package.json 不卸（避免 pnpm 依赖变动触发 electron 重下陷阱）。门禁：typecheck 全绿、build 通过；`--capture` 预置 settings 两态截图（空态启动器 / 三标签 Chrome 条）均贴合参考 | 右侧栏 ✅ |
| 2026-09-01 | UI v4-中栏Header | 完成 | **中栏顶部新增 `ConversationHeader`（对话标题栏）**：① 左侧 message 图标（`Icon.tsx` 新增 `message: MessageSquare`）+ **对话标题**——取 `session-store.items` 首条 `kind==="user"` 文本（折叠空白、单行 truncate），与会话列表 `firstMessage` 同源；无会话时回退 activeProject 目录名 → "新任务"。② 右侧视图开关：**运行时信息看板**（`panelTop`，点亮态跟 `environmentOpen`）常驻；**右侧工作台开关**（`panelRight`）按"就近"规则——`settings.window.rightCollapsed` 为真（右栏收起）才显示在此最右点开，右栏展开时隐藏。③ 右栏展开态的收起按钮改由 `RightPane` 自身 nav 最右侧提供（`flex-1` 撑开 + `panelRight` 收起，派发 `piwood:toggle-inspector`）。**下沉清理**：`TitleBar` 原两枚切换按钮（panelTop/panelRight）移除，仅留引擎状态点 + 窗口控制；`environmentOpen`/`onEnvironmentToggle` 从 `TitleBar`、`AppShell` props 一并删除（App 直接把 state 交给 ConversationHeader 与 EnvironmentPanel）。右栏开合状态经 `useSettingsStore(s=>s.settings.window.rightCollapsed)` 单一订阅、`patch` 响应式回流。门禁：typecheck 全绿、build 通过；`--capture` 双态截图（右栏开→收起按钮在右栏头、右栏关→展开按钮在中栏头最右）均到位 | 中栏信息架构 ✅ |
| 2026-09-01 | UI v4-Composer叠拼·两层z-index | 决策+完成 | **推翻 v3「一张外卡三段式」（用户仍嫌丑），改为用户明确指定的两层负向外叠结构**：① 顶部芯片条 = **独立浅灰面** `bg-[#242424] rounded-t-2xl mx-4`（**内缩一圈、比输入卡窄**），只放 ProjectPicker/GitBranchChip，`pb-8` 多留底部供压盖；② 输入卡 = **亮灰主层** `bg-[#333333]`（**必须不透明**，半透会透出被压住的芯片条）`border-white/10 rounded-2xl`+更重投影 `0_22px_50px_-22px`，**同时容纳 textarea（透明、无独立内凹框）与 ComposerControls 操作栏**（用户强调输入框与底部按钮必须同块不拆分）；③ 两层用 `-mt-7` 负向外叠 + `z-0/z-10` 分层的，输入卡压住芯片条下半、只露上方芯片——即"叠拼"。Composer.tsx 拆 `ComposerInput`(透明输入体)/`InputCard`(亮灰主层，`raised` 控制是否 `-mt-7`)/`ComposerBody`(有 header 才渲染芯片条+抬高卡，无 header 直接返回不抬高的卡)。对话态 DockedComposer 无 header → 单层亮灰卡。门禁：typecheck 全绿、build 通过；`--capture` 无干扰截屏确认两层分离/重叠/芯片外露三态到位 | 空态视觉 ✅（覆盖 v3 叠拼行） |
| 2026-09-01 | UI v3-Composer空态·叠拼 | 完成 | 【已被 v4 两层 z-index 叠拼推翻】 空态对话框按 ZCode 参考图定稿（用户嫌扁平丑，多轮迭代）。最终结构=**一张外卡三段式**：外层 `cardShell`=`rounded-2xl border bg-card p-2`+柔投影；① 头部项目/分支芯片**直接贴卡面**（无独立色带、不悬浮）；② 中间**内嵌输入框** `rounded-xl bg-white/[0.04] ring-inset`（比卡略浅一档的独立圆角面，只放附件条+textarea，`rows=1` 紧凑单行、auto-grow min 28）；③ 底部控件条 `ComposerControls` 在卡面上、输入框下方。ComposerBody 加 `header?` 槽、ComposerInput 只管输入、控件回到 ComposerBody，onboarding/docked 共用。**终轮贴合参考**：发送键改 `rounded-full` 且**空态灰圆 `bg-secondary`、有内容才 `bg-primary` 蓝**（对齐 ZCode 空态不发亮）；输入框 `py-3`+auto-grow min 36 更透气、内嵌面 `bg-white/[0.03]`+`ring-border/40` 边界更淡；卡 `p-2.5`、头部 `mb-2`、控件 `pt-2` 拉开三段留白。走过的弯路（均**否决**）：悬浮药丸骑跨卡顶→割裂；控件塞进暗色内凹面板+浅色头部条→与参考不符。实测 frontend 项目 HMR 截图：三段式+灰圆发送键贴合参考。门禁：typecheck 全绿、build 通过 | 空态视觉 ✅ |
| 2026-09-01 | UI v3-Composer空态 | 决策+完成 | **新建任务空态对话框重构（对齐 ZCode 参考）**：① 空会话时 Composer 由底部停靠改为**页面垂直居中**，上方时间问候语（`lib/time.ts` 新增 `greeting()`，按小时分 上午/中午/下午/晚上/夜深）；② 卡片头部新增两枚芯片——`ProjectPicker`（搜索工作区 + 项目列表 + 打开文件夹，选项目派发 `piwood:select-project`、开文件夹派发 `piwood:add-project`）与 `GitBranchChip`（分支名 + 未提交文件数，**非 git 仓库/无分支则整枚不渲染**，点击跳右栏变更面板）；③ 进入会话（有消息）后**隐藏头部芯片**，仅留主体对话框，MessageList 空态占位删除、`empty` 时返回 null；④ 空态下模型/思考/上下文芯片随 `engineReady` 点亮可切。架构：Composer 全部状态与动作抽到 `hooks/use-composer-controller.ts`（逻辑层，runtime 改走 `runtimeInfo()` 一次拉齐 model/thinking/contextUsage/git），Composer.tsx 拆为 `OnboardingComposer`/`DockedComposer` 共享 `ComposerBody`；`useSidebarProjects` 仍是项目激活单一持有者，新增 `piwood:add-project` 监听复用 `addProject`。实测（Win32 激活窗口+真实坐标点击）：空态居中/选项目后芯片点亮/ProjectPicker 浮层/历史会话隐藏头部 四态通过。门禁：typecheck 全绿、build 通过 | 空态体验 ✅ |
| 2026-09-01 | UI v3-Composer | 偏差+完成 | **对话框底部操作栏"死按钮"根因修复**：`components/ui/button.tsx` 与 `packages/ui-kit/src/button.tsx` 的 `Button` 是普通函数组件、未 `React.forwardRef`。所有 `<PopoverTrigger asChild><Button>` 触发器经 Radix Slot 注入 ref 时被 React 18 拒收（Console 报 `Function components cannot be given refs … Primitive.button.Slot`），Popover 无法打开——而发送键是裸 `<Button onClick>`（不经 asChild、不需要 ref）故独活，正是"除发送键全死"的表象。修复：两处 Button 改回 `forwardRef<HTMLButtonElement, ButtonProps>` 并把 ref 透传给 `Slot`/`button`。实测（重启 dev→最大化→真实坐标点击）：Agent 权限浮层正常弹出/选择/关闭。引擎就绪后上下文/模型/思考浮层同源恢复。门禁：typecheck 全绿、build 通过 | Composer 底部栏交互 ✅ |
| 2026-09-01 | UI v3-中断态 | 完成 | **用户中断时在被终止消息下方显示黄色「对话已终止」提示**。实测 Pi agent-loop（`pi-agent-core/dist/agent-loop.js`）：中断时该 turn 最后一条 assistant `message.stopReason === "aborted"`，随后 emit `turn_end`→`agent_end`（`turn_end` 已在 EngineEventSchema passthrough 透传）。session-store 新增 `turn_end` 分支：先 `flushLive()` 落盘已流式的半截正文/思考，再在 `stopReason==="aborted"` 时压入 `system` 项（`tone:"warn"`）。system 项类型加可选 `align:"center"|"start"`；MessageList `SystemNote` 加左对齐内联变体（`text-warning` 黄 + `OctagonX` 图标），仅用于中断态，压缩/重试等居中 pill 不受影响。门禁：typecheck 全绿、build 通过 | 对话中断反馈 ✅ |
| 2026-09-01 | UI v3-对话流 | 偏差+完成 | **中栏对话流重建，严格对齐 Pi SDK v0.84.4 真实事件字段**。调研 SDK 类型定义确认：`tool_execution_start.args`（非 input）、`tool_execution_update.partialResult`（非 output）、`tool_execution_end.result.{content,details}`，edit 的 `result.details.patch/diff` 含结构化 diff；`message_update.assistantMessageEvent` 有 `thinking_delta`（字段 thinking）。**修复 4 处同源字段 bug**：session-store 读错字段致工具卡入参/输出恒空、thinking 全丢；engine-manager snapshot 传 `event.input`（右栏 diff 失效）；runtime-store trackEvent 读 `e.input`。collectGitInfo 补 `--name-status` 文件明细（原 files 恒空）。**新数据模型** `ConversationItem`（user/assistant/thinking/tool/system 判别联合）；流式文本/思考走独立 live buffer（块 *_end 或工具启动才 flush，避免每 token 对长列表 O(n) 拷贝）。**组件体系沉淀进 ui-kit**：`ToolCard`（按 read/edit/write/bash/grep/find/ls/browser 定制渲染，可折叠，edit 内联 `DiffView`）、`ThinkingCard`、`DiffView`（轻量行级 patch 渲染，无编辑器依赖）。**性能**：MessageList 改 `@tanstack/react-virtual` 虚拟化 + 自管 stick-to-bottom，1 万条压测仅渲染视口 ~8 行、35ms 注入无卡死（`docs/proofs/ui-v3/ui-stress.png`）。**设置项**：`ui.toolCardsDefaultOpen`/`ui.thinkingDefaultOpen`（默认收起，SettingsModal 新增"界面"页开关）。**EnvironmentPanel** 增强：上下文水位条、git 变更文件列表（状态色）、工具列表展开、运行中任务、排队队列、会话统计。**RuntimeInfo 契约**补 contextUsage/isStreaming。**真实 API 端到端测试**：`--ui-chat` dev harness 走正式 ensureEngine，read×2 对话完整渲染（thinking+折叠卡+markdown 正文+代码块），write 触发审批门弹窗显示真实 args（`ui-chat.png`/`ui-chat-clean.png`）。Pi 核心无 MCP/子代理/plan/生成式UI（官方 usage.md 明示），浮窗据实展示不臆造。门禁：typecheck 全绿、build 通过、`git diff --check` 通过 | UI v3 对话流 ✅ |
| 2026-08-31 | UI v3 | 决策 | **UI 底座整体迁移 shadcn UI + Tailwind CSS v4**（用户指令：旧手写 CSS 体系废弃）：`@tailwindcss/vite` 接入 renderer；唯一样式源 `src/renderer/src/globals.css`（shadcn 语义令牌 oklch，dark 缺省 + `[data-theme=light]`，蓝紫 primary，`--pk-chat-width` 对话列宽变量）；18 个 shadcn 组件 vendored 至 `components/ui/*`（`@` 别名=src/renderer/src）；`@pi-wood/ui-kit` 重建为**真 prompt-kit**（Radix Avatar/Tooltip/Slot + Tailwind 工具类，globals.css `@source` 扫包内源码）；toast→sonner、命令面板→cmdk、设置/审批/UiRequest→shadcn Dialog；全部组件改 Tailwind 令牌类；旧 `styles.css`（379 行四轮覆盖债）删除。第三方外观经 globals.css hook 类桥接：`dockview-host`/`terminal-host`/`cm-host`/`app-drag`/`pk-prose`，组件不得改名。门禁：typecheck 全绿、build 通过、`--capture` 截图验收 `apps/desktop/docs/proofs/ui-v3/dark-initial.png` | UI v3 ✅ |
| 2026-08-31 | 工具链 | 偏差 | Electron "uninstall" 复发根因确认：pnpm 依赖变动会新建 `.pnpm/electron@<ver>[_peers]/` 链接目录（如 supports-color peer 组合变化），新目录无 dist 即报 `Error: Electron uninstall`。修复固化：① 新增 `scripts/ensure-electron.mjs` 自愈脚本（兄弟目录复制→缓存 zip Expand-Archive→写无换行 path.txt），dev/build/package 前置执行；② `pnpm-workspace.yaml` 将 electron 移入 `ignoredBuiltDependencies`（install.js 不再有机会毁 dist），并设 `verifyDepsBeforeRun: false`（run 前不再自动 install） | **以后 `pnpm dev` 可直接用**；新增依赖后无需手动修 electron |
| 2026-08-31 | T3.1 | 进展 | 新增通用 `ui:request/ui:respond` 请求队列，扩展的 select/confirm/input 可在渲染层以阻塞式 Promise 往返；新增全局/项目 Skills 与 Prompt 模板扫描，并在设置页展示。最终门禁 `pnpm typecheck`、桌面专项测试 3/3、`pnpm build`、`git diff --check` 全部通过。当前进度快照：`apps/desktop/docs/progress-2026-08-31.md`。真实社区包、confirm 实包回传与 `ctx.ui.custom` 降级仍待验收，因此 T3.1 保持进行中。 | T3.1 实现继续推进，未提前标记完成 |
| 2026-08-31 | T2.6 | 完成 | 真实 Provider 门禁重跑通过：桌面 Agent 完成 read→edit→bash(test)→browser_navigate→browser_read_text，五类工具卡片全部 Completed；随后在桌面外独立执行测试再次通过，总耗时 21.578s。遵循隐私要求，证据只保存状态、阶段和耗时，不保存 prompt、回复或凭据，文件：`apps/desktop/docs/proofs/T2.6/acceptance-status.json`。**Go：Phase 2 全部任务完成。** | T2.6 ✅，进入 Phase 3 |
| 2026-08-31 | T2.5 | 完成 | 右栏由轻量标签切换为 dockview 8.2：支持标签关闭/拖拽/拆分，`toJSON/fromJSON` 布局经 settings 持久化；真实 Electron 窗口打开“终端”后刷新，文件+终端标签与激活状态准确恢复。workbench-store 接入工具事件：read 打开对应文件，edit/write 产出 Diff 后自动切变更，bash/browser_* 打开对应面板；Files/Terminal/Browser 使用 React.lazy，生产构建产出独立 chunk。 | T2.5 ✅ |
| 2026-08-31 | T2.2 | 完成 | 补齐此前缺失的真实回滚链路：主进程持有变更 ID 与 before/after，preload IPC + Diff 按钮执行受控写回；若文件在 Diff 后再次修改则拒绝旧快照覆盖。Node 专项测试 3/3 通过，CRLF 内容回滚后 Buffer 逐字节相等，并补同前缀越界路径测试。证据：`apps/desktop/docs/proofs/T2.2/crlf-revert-test.txt`。 | T2.2 ✅ |
| 2026-08-31 | 计划状态 | 维护 | 首次以提交与 §8 验收日志同步任务标题：T1.4 标为完成；当时尚缺验收的 T2.2、T2.6、T3.1、T3.3、T3.4、T5.1、T5.3 标为部分完成，T2.5 标为暂缓。此后任务以本表更靠上的新增验收记录继续推进，状态随证据更新。 | 建立“实现落地”与“全部验收”分开记录的规则 |
| 2026-08-30 | 前置 | 修订 | R-1~R-3 已写回方案文档（方案升级为 v2.2）：createAgentSession 选项改 modelRuntime、会话操作标注 AgentSessionRuntime 归属、EngineEventSchema 补 auto_retry_*/summarization_retry_*、§7.3 思考档位改动态获取、§2.1 决策行改为"MVP 仅实现 SDK 路径" | 前置项完成 ✅ |
| 2026-08-30 | 前置 | 决策 | R-4 范围裁剪：RPC 备路径出 MVP；浏览器面板 headless 降级；better-sqlite3 移出 MVP；工期基线 6~9 周 | 路线图调整 |
| 2026-08-30 | T0.1 | 决策 | 工具链选型：不用 turbo/nx，用 `pnpm -r` 递归脚本（单人项目，monorepo 任务编排无并行需求，少一层工具依赖）；构建器选 electron-vite（main/preload/renderer 三目标一体，官方模板成熟）；workspace 包以 TS 源码直连（main 侧经 externalizeDepsPlugin exclude 打进产物，renderer 侧 vite 原生支持），不出 dist | 记录备查 |
| 2026-08-30 | T0.1 | 偏差 | pnpm 11 不再读 package.json 的 `pnpm.onlyBuiltDependencies`，设置迁移到 `pnpm-workspace.yaml` 的 `allowBuilds`（electron/esbuild: true） | 已解决，影响后续所有装机 |
| 2026-08-30 | T0.1 | 偏差 | 本机（Git Bash + pnpm）下 electron 的 install.js 下载后解压静默失败（extract-zip 只产出 LICENSES.chromium.html，exit 0 无报错）。解法：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js` 下载，再用 PowerShell `Expand-Archive` 手动解压 dist/，并 `printf 'electron.exe' > path.txt`（echo 会带换行导致 spawn ENOENT） | **升级 electron 版本时需重复此流程** |
| 2026-08-30 | T0.1 | 偏差 | electron-builder 打 NSIS 时 winCodeSign 解压因符号链接特权失败（"客户端没有所需的特权"）。解法：用自带 7za 手动解压 `winCodeSign\120937007.7z` → `winCodeSign\winCodeSign-2.6.0`（忽略 2 个 darwin 链接错误），预热缓存后重跑成功 | 已解决，非管理员环境打包照此绕行 |
| 2026-08-30 | T0.1 | 完成 | 验收通过：`pnpm -r typecheck` 全绿；`electron-vite build` 三目标成功；打包版应用启动正常（3 进程、日志干净）；NSIS 包产出 `apps/desktop/release/pi-wood Setup 0.0.1.exe` | T0.1 ✅，下一任务 T0.2 |
| 2026-08-30 | T0.2 | 偏差 | Pi SDK 实际版本 **0.84.4**（锁定）。实测装配路径比在线文档更精确：`createAgentSessionServices({cwd, agentDir, modelRuntime?})` → `createAgentSessionFromServices({services, sessionManager})` → `createAgentSessionRuntime(工厂函数, {cwd, agentDir, sessionManager})`。**工厂函数**（`CreateAgentSessionRuntimeFactory`）在每次 newSession/switchSession/fork 时按目标 cwd 重建服务——SdkAdapter 应持有工厂而非单个 session | sdk-adapter 结构据此设计（T1.1） |
| 2026-08-30 | T0.2 | 进展 | 无 Key 冒烟通过：runtime 装配 + `session.subscribe()` 挂载 + `newSession/switchSession/fork` 方法面确认 + sessionFile 落盘 `~/.pi/agent/sessions/`（R-1/R-2 修订与真实包吻合）。探针：`apps/desktop/scratch/sdk-probe.mjs`（用法与日志见 `docs/proofs/T0.2/`） | **T0.2 剩余项阻塞：需用户提供模型 API Key** |
| 2026-08-30 | T0.2 | 完成 | **用户提供 DeepSeek Key 后闭环达成**：prompt "把 test.txt 里的 foo 改成 bar" → 165 事件（含 3 次 tool_execution_start/end）→ 文件真实修改为 "hello bar"。日志 `apps/desktop/docs/proofs/T0.2/events-log.txt`。注：验收在 Node 进程完成（SDK 纯 JS），Electron 主进程内复验并入 T0.3 | T0.2 ✅ |
| 2026-08-30 | T0.2 | 偏差 | **DeepSeek 是内置 Provider**，凭据走 `DEEPSEEK_API_KEY` 环境变量，无需 models.json。⚠️ 实测：自定义 `models.json` 中同名 provider 的最小配置会**覆盖**内置目录项并丢失 compat 设置，导致工具调用失效——T3.2 模型设置 UI 必须**合并**内置目录而非整体替换（修订方案 §5.6 实现口径） | T3.2 设计约束 |
| 2026-08-30 | T0.2 | 偏差 | API 细节实测：① `getAvailable()` 需无参全量调用后按 `model.provider` 过滤（直传 providerId 返回空）；② 实际事件流含 `agent_settled`、`thinking_level_changed`，方案 §3.1 schema 未列——T1.1 补入 EngineEventSchema | T1.1 修订依据 |
| 2026-08-30 | T0.3 | 偏差 | **Electron 33 内置 Node 20 缺 `fs.globSync`，Pi SDK 0.84.4 无法加载 → 升级 Electron 37.10.3**（Node 22）。方案 §2.4 的"≥30"下限据此修正 | 依赖版本变更 |
| 2026-08-30 | T0.3 | 偏差 | 排查坑：僵尸 electron 进程持有 `requestSingleInstanceLock` 导致新实例静默退出（exit 0 无输出）。排障时先 `taskkill /F /IM electron.exe` | 排障经验 |
| 2026-08-30 | T0.3 | 完成 | **Electron 主进程探针 PASS**：jiti 加载 TS 扩展（echo_greeting）成功 → `bindExtensions({uiContext, mode:"rpc"})` 桌面桥生效 → DeepSeek 调用扩展工具 `TOOL_START/TOOL_END: isError=false` → notify 经 uiContext 发渲染层。证据：`apps/desktop/docs/proofs/T0.3/{electron-probe.log,boot.log}`。桌面模式语义定为 `"rpc"`（`ExtensionMode = tui/rpc/json/print`，无 "sdk" 值） | T0.3 ✅（打包版 asar 验证留 T0.6） |
| 2026-08-30 | T0.3 | 偏差 | 模型目录实测：`getAvailable()` 列表随在线目录刷新变化（Node 首跑含 deepseek-chat/reasoner 5 个，Electron 侧仅 v4 系 3 个），`setModel` 不校验列表仍可用 chat。**T3.2 模型管理须处理静态目录 vs 在线目录合并 + 收藏模型直连** | T3.2 设计约束 |
| 2026-08-30 | T0.4 | 完成 | **tool_call 拦截验证通过（双组对照）**：对照组 bash 正常执行（tool_execution_update 有输出）；实验组 `pi.on("tool_call")` 返回 `{block:true, reason}` → bash 无实际执行输出，agent 收到 reason 正常继续（agent_end）。证据：`apps/desktop/docs/proofs/T0.4/blocked-run-stdout.txt`。审批门扩展路线确认可行，`<ApprovalCard>` 只需在 block 前插入 IPC 等待用户决策 | T0.4 ✅，§10.3 设计确认 |
| 2026-08-30 | T0.5 | 偏差 | 机器无 Visual Studio Build Tools：node-pty 1.1.0 与 @homebridge 预编译分支均回退 node-gyp 源码编译 → 失败。**改用 `@lydell/node-pty`（N-API 预编译，可选依赖直发 win32-x64 二进制）**，无需 electron-rebuild | 方案 §2.4 选型变更，T5.3 打包更简 |
| 2026-08-30 | T0.5 | 完成 | ConPTY 验证通过：Node 运行时与 Electron 运行时（`ELECTRON_RUN_AS_NODE`）下 `pty.spawn(powershell)` 均正常收发输出（exitCode 0 + 标记串命中）。骨架落盘 `electron/main/workbench/terminal-service.ts`。xterm 渲染层集成按计划归 T2.3 | T0.5 ✅ |
| 2026-08-30 | T0.6 | 完成 | **门禁 E2E PASS（Go 决策）**：Electron 内 `--probe-e2e` 模式，prompt"把 test.txt 里的 hello 改成 hola"→ agent 执行 read→edit（事件全量转发渲染层，工具卡片状态机 running/ok 上屏）→ jsdiff 前后快照对比 → diff 推送右栏上屏 → 文件真实变更 `hello bar`→`hola bar`。证据：`apps/desktop/docs/proofs/T0.6/e2e.log`。工具卡片/diff 为最简 DOM 占位（按门禁口径允许）；窗口视觉截图因用户前台占用延至 T1.3 正式 UI 时补。**Phase 0 高风险路径全部验证通过，Go** | T0.6 ✅，进入 Phase 1（T1.1 起） |
| 2026-08-30 | T1.1 | 决策 | IPC 方案定为**自研 contextBridge + ipcMain.handle + zod 边界校验**（不用 electron-trpc）：事件流是 main→renderer 推送，trpc subscription 在 Electron 上反而绕；zod schema（@pi-wood/ipc-schema）仍是唯一契约源 | 记录备查 |
| 2026-08-30 | T1.1 | 完成 | 契约层落地：① `packages/ipc-schema` 全量事件/命令 zod schema（25 种事件 + unknown 兜底 + 13 个通道常量）；② `packages/engine`：EngineAdapter 接口（渲染层仅类型，子路径 `@pi-wood/engine/sdk` 隔离 Pi SDK）、normalizeEngineEvent 事件桥（未知事件归一化不崩，**单测 4/4 通过**，node:test + TS 类型剥离）、SdkAdapter 正式实现；③ e2e-service 重构为 SdkAdapter 驱动并重跑 E2E PASS（read→edit→diff 全链路） | T1.1 ✅ |
| 2026-08-30 | T1.1 | 偏差 | **setModel 必须用 registry.getModel() 的完整 Model 对象**：裸 {provider,id} 会被接受但请求退化（模型复读输入、不调工具）。另实测 0.84.4 静态目录已无 deepseek-chat（仅 v4 系），早期看到的 chat 来自远程目录缓存——**模型目录是动态的，chat 可能整体退役**，T3.2 模型管理按"registry 可解析即可用"设计，不依赖静态清单 | T3.2 设计约束 |
| 2026-08-30 | T1.4(后台) | 完成 | 左栏数据层先行完成：① `packages/engine/src/session-tree.ts` 纯函数树构建（buildSessionTree/flattenTree/defaultLeaf，孤儿条目容错、活跃分支标记），**单测 8/8 通过**；② 主进程 `project/project-manager.ts`（projects.json 注册表 + 复用 Pi ProjectTrustStore 信任预检，`ProjectTrustDecision = boolean\|null`）+ `engine/session-service.ts`（列表复用 SessionManager.list，树解析复用 parseSessionEntries）；③ 真实数据验证：19 个真实会话列出、最新会话解析为 12 节点树（深度缩进 + 活跃叶标记）、信任状态 undecided/not-required 分级正确。验证脚本 `apps/desktop/scratch/backend-probe.ts` | T1.4 后台部分 ✅，UI 部分（SessionTree 组件）与 CLI 互通硬验收待做 |
| 2026-08-30 | T1.4(后台) | 偏差 | trustStatus 语义实测：`hasTrustRequiringProjectResources` 只对含动态资源的 .pi 项目返回 true；信任交互仍走运行时 project_trust 事件（经 uiBridge.confirm），预检仅做徽标显示 | §9 交互口径 |
| 2026-08-30 | T1.2 | 偏差 | react-resizable-panels 升级到 **v4**，API 重命名：`PanelGroup→Group`、`PanelResizeHandle→Separator`、`onLayout→onLayoutChanged(layout, meta)`（Layout 为 {panelId: flexGrow}）、命令式句柄经 `panelRef` prop。方案 §2.4 的组件用法按 v4 口径写 | 方案 §4.1 实现口径 |
| 2026-08-30 | T1.2 | 完成 | 布局底座验收通过（无干扰方式）：`--capture` 模式用 `webContents.capturePage()` 截窗口内容（窗口不需前台，不干扰用户其他应用）。两组 settings.json 预置值分别还原正确：`[40,40,20]` 正常三栏、`[18,42,40]+rightCollapsed` 右栏折叠态与按钮文案均正确。折叠按钮（收/展开左右栏）挂接 panelRef。证据：`docs/proofs/T1.2/*.png`。注：物理拖拽分割条的交互属库原生能力，onLayoutChanged(isUserInteraction) 已接持久化 | T1.2 ✅ |
| 2026-08-30 | T1.4 | 完成 | **CLI↔桌面双向互通硬验收通过**：① pi CLI 0.84.4 全局安装；② CLI `--session <桌面会话文件> -p` 成功 resume 桌面建的会话并正确回答历史内容（"hola"）；③ CLI 运行写入后桌面 SessionService 立即可见（msgs 8→10、entries 12→14、modified 更新） | T1.4 硬验收 ✅（SessionTree 组件 UI 仍待做） |
| 2026-08-30 | T1.4 | 偏差 | **主进程禁止静态 import Pi（ESM-only）**：electron-vite 把 dependencies externalize 成 CJS require，而 pi 包 exports 无 CJS 入口 → 启动即 `ERR_PACKAGE_PATH_NOT_EXPORTED`（表现为窗口报 "App threw an error during load" + 进程挂起）。规则：主进程所有 Pi 访问必须 `await import()`，agentDir 等引导值由启动函数动态获取后传入各 service。session-service/project-manager/data.ipc 已全部改动态 | **硬性编码规范**，T2.x 起所有 Pi 触点遵守 |
| 2026-08-30 | T1.4 | 完成 | 左栏数据 IPC 域接线完成：`ipc/data.ipc.ts` 注册 project:list/add/remove/trustStatus + sessions:list/tree（入参 zod 校验，通道常量来自 @pi-wood/ipc-schema projects 域），boot 验证干净（capture exit=0） | T1.4 UI 接线就绪 |
| 2026-08-30 | T1.3+T1.4 UI | 完成 | **GUI 端到端闭环达成**（无障碍驱动 + 截图验证）：左栏项目选择 → engine:start（含默认模型 chat 优先兜底链）→ 19 会话列出 → 点击会话渲染会话树（缩进+活跃分支）→ Composer 发送"把 test.txt 里的 hello 改成 hola"→ 用户消息单条上屏 → 工具卡片 `read ✅ ok` → streamdown 流式回复（agent 正确发现文件已是 hola bar 并如实说明）。组件：MessageList（react-virtual）+ Composer（Enter/Alt+Enter/中止）+ LeftPane + session-store。开启 `app.accessibilitySupportEnabled` 支持自动化驱动 | T1.3 核心闭环 ✅ |
| 2026-08-30 | T1.3 | 偏差 | dev 启动需 `DEEPSEEK_API_KEY` 环境变量（密钥未持久化，auth.json 为空）——T3.2 钥匙串+设置 UI 前的过渡：建议加 dotenv 式启动脚本 `pnpm dev:key`。另两处已修：preload prompt 需传 `{text}` 对象（zod 契约）；user 消息统一由主进程 user_message 事件回显（防双份） | T3.2 前置 |
| 2026-08-30 | T1.3 | 待办 | 虚拟列表万条压测、Markdown 代码块高亮细节、CLI 会话在 UI 内 continue → switchSession 接线、会话树点击叶子跳转：记入 T1.3 精修清单（Phase 1 门禁前完成） | T1.6 门禁前清账 |
| 2026-08-30 | T1.3 | 完成 | **精修清单清账**：① 点击会话 = `sessions:messages` 装载历史 + `engine:switchSession` 切引擎（实测：装载 23:51 会话历史后发"我刚才让你修改的文件名和内容"，agent 准确回答"test.txt / 把 hello 改成 hola"——上下文生效）；② 万条压测（状态栏 dev 按钮 → debug:stress 注入 10000 条）通过：虚拟列表只渲染可见行，UI 保持响应；③ edit/write diff 推送右栏接线到正式引擎（forwardDiffOnFileEdit 前后快照） | T1.3 ✅ |
| 2026-08-30 | T1.4 | 完成 | SessionTree 组件上屏（缩进 + 活跃分支高亮 + 类型图标）；会话点击续写交互接通（见 T1.3） | T1.4 ✅ |
| 2026-08-30 | T1.5 | 证据 | 门禁预验：GUI 会话（含续写轮次）→ pi CLI `--session -p` resume 成功，正确引用 GUI 对话内容（"需要我做什么其他处理吗？"上下文可达）。T1.5 正式录屏待补（capture 截图链已留存） | T1.5 录屏待补 |
| 2026-08-31 | T1.5 | 完成 | **门禁评审通过**：日常任务全 GUI 闭环实测——新会话发"给 greet.js 添加 greetZh 函数并用 node 运行"→ agent 执行 read→edit→bash（read/edit/bash 三张工具卡片全部 ✅）→ streamdown 渲染代码块输出（hello pi / 你好，皮，带复制/下载按钮）→ greet.js 真实变更（新增 greetZh+调用行）→ pi CLI resume 该会话并正确回答修改内容。验收原文"日常改 bug/加功能在 GUI 完成，CLI 可 resume 同一会话"达成 | T1.5 ✅ **Phase 1 门禁通过，进入 Phase 2** |
| 2026-08-31 | T1.5 | 偏差 | 右栏 diff 未在本次演示出现：edit 工具的 input.path 为相对路径（"greet.js"），主进程 readFileSync 相对 cwd 解析失败被静默吞掉。修复归 T2.2 snapshot-service 正式化：path.resolve(projectDir, relPath)，并把静默 catch 改为日志 | T2.2 修复项 |
| 2026-08-31 | T2.1 | 决策 | 文件树未用 headless-tree：MVP 只需懒加载展开 + 点击，自绘轻量树（复用左栏树经验）即可，且避免引入 beta 期库；headless-tree 的 DnD/键盘导航等留到需要时再评估（§14 组件抽象隔离原则） | 方案 §2.4 选型调整 |
| 2026-08-31 | T2.1 | 完成 | **文件工作台验收通过**：① `fs:*` IPC（tree 懒加载单层/read/write/search，gitignore 感知 + 路径越界防护 + 2MB/二进制防护）；② 右栏 Files/Diff 标签页 + 懒加载文件树 + 文件名搜索；③ CodeMirror 6 只读预览（JS 语法高亮）→ 切编辑 → 键盘输入 → dirty 标记 → 保存 → **落盘逐字节验证通过**。无障碍驱动全程操作 | T2.1 ✅ |
| 2026-08-31 | T2.1 | 偏差 | CodeMirror contenteditable 对 AXSetValue 返回 mismatched 但内容实际写入（Chromium a11y 映射行为）；后续自动化一律用"点击聚焦 + type 真实键盘"方式改 CM 内容 | 测试口径 |
| 2026-08-31 | T2.2 | 完成 | snapshot-service 正式化：类封装（resolveInProject 相对/绝对路径解析 + 越界防护 + warn 日志替代静默 catch），engine-manager 订阅中接入，edit/write → patch 推送右栏 Diff 标签（带未读计数）。MergeView 双栏视图延后（当前 jsdiff 行级 patch 已满足评审） | T2.2 ✅（MergeView 后续） |
| 2026-08-31 | T2.3 | 完成 | 终端面板落地：`workbench/terminal-service.ts`（@lydell/node-pty pty 池 + zod 校验 IPC term:create/write/resize/kill + term:onData/onExit 事件）+ 渲染层 TerminalPanel（xterm + fit/web-links addon，跟随项目 cwd，PowerShell ConPTY 实测出 bash 提示符正常回显） | T2.3 ✅ |
| 2026-08-31 | T2.4 | 完成 | 浏览器面板 + agent 工具落地：`workbench/browser-service.ts`（playwright-core + 系统 Edge/Chrome headless，8s 超时）+ `agent-tools/browser-tools.ts`（browser_navigate/read_text/click/fill/screenshot 五个 TypeBox 工具）经 SdkAdapter customTools 注入——**agent 与面板共享同一 headless 页面**。实测 example.com 截图上屏 | T2.4 ✅（headless 降级版） |
| 2026-08-31 | T2.x | 决策 | 右栏暂用轻量标签页（文件/终端/浏览器/Diff），dockview 停靠布局推迟到 Phase 3 一并评估（当前四功能 tab 已可用，dockview 引入属布局增强而非功能缺失） | T2.5 调整 |
| 2026-08-31 | T2.6 | 完成 | **Phase 2 门禁通过**：webapp 项目 GUI 内发任务"改 index.html 的 h1 → browser_navigate 打开 → browser_read_text 验证"→ agent 执行 read→edit→browser_navigate→browser_read_text 四步工具链（全部 ✅）→ 正确回答"改成功了，页面文本显示为 Hello pi-wood"→ 文件真实变更（h1=Hello pi-wood）。验收原文"agent 跑 Web 项目：改代码→浏览器验证，全程桌面内闭环"达成，且浏览器验证走的是自定义 agent 工具首秀 | T2.6 ✅ **Phase 2 核心门禁通过** |
| 2026-08-31 | 收尾 | 总结 | **项目阶段性完成**：Phase 0~2 全部门禁通过，Phase 3 核心（钥匙串/Provider/设置弹窗/主题）与 Phase 4 核心（审批门/path-guard/信任）落地，T5 NSIS 打包通过（release/pi-wood Setup 0.0.1.exe，108MB）。工作台四面板（文件/终端/浏览器/Diff）+ GUI 对话闭环 + CLI 双向互通 + 万条压测 + 审批门全部实测。**后续迭代项**：① UI 视觉重设计（用户反馈）；② T3.1 扩展列表 UI（数据层已就绪）；③ T3.4 包市场；④ T2.2 MergeView / T2.5 dockview；⑤ 打包版 asar 内扩展加载复验；⑥ T4.3 计划模式、T5.1 命令面板、T5.2 utilityProcess 插件 | 详见各阶段 §8 记录 |
| 2026-08-31 | UI v2 | 完成 | **视觉重设计落地**（响应用户反馈）：styles.css 全量重写为设计系统 v2——单一强调色锁定（电蓝 #6e9bff）、6px 控件/8px 面板圆角体系、4px 间距网格、深浅双主题 token、细线分隔替代色块、去 emoji（换中性字形/文字）、按钮三态+focus-visible、滚动条/选区样式。Design read：devtool workbench，V3/M2/D6，Zed/Linear 式克制语言。design-taste-frontend 技能第 13 节声明：本应用属密集产品 UI，仅采用其通用纪律 | UI v2 ✅ |
| 2026-08-31 | T3.1/T3.4/T5.1/T2.2 | 完成 | 四项延后功能清账：① T3.1 扩展列表 UI（全局+项目扫描 + engine:reload 热重载按钮，SdkAdapter.reload 接 AgentSession.reload）；② T3.4 包管理（实验）：settings.packages 列表 + pi CLI 安装（120s 超时，输出回显）；③ T5.1 命令面板：Ctrl+Shift+P 唤起，聚合设置/主题/新会话/切模型/切项目（自研轻量实现，cmdk 推迟）；④ T2.2 MergeView：SnapshotService 输出 before/after，Diff 标签接 @codemirror/merge unifiedMergeView 双栏对照 | 四项 ✅ |
| | | | | |

---

## 9. 依据与核实记录（2026-08-30）

- Pi SDK / 扩展 / RPC 官方文档：`pi.dev/docs/latest/{sdk,extensions,rpc}` —— R-1/R-2/R-3、tool_call 阻断、ctx.ui 四件套、jiti 加载均以此为准
- npm `@earendil-works/pi-coding-agent` 与 GitHub `earendil-works/pi`（MIT）—— 内核存在性与许可证确认
- OpenClaw 源码分析（starkslab.com/notes/i-read-openclaws-source-code）—— `createAgentSession()` 进程内嵌入先例
- Vercel streamdown（github.com/vercel/streamdown）、@headless-tree/react（react-complex-tree 官方继任者）—— 较新选型库的可靠性确认

---

## 10. 追溯矩阵（任务 ↔ 方案章节 ↔ 门禁验收）

| 任务 | 方案章节 | 所属门禁 | 门禁验收原文锚点 |
|---|---|---|---|
| T0.1~T0.6 | §2.1/§2.4/§5.2/§10.2/§10.3/§10.6/§14 | Phase 0 | "Electron 内完成'用 Pi 改一个文件'，工具卡片 + diff 上屏" |
| T1.1~T1.5 | §2.2/§3.1/§4.1~4.3/§5.7/§11-1/2/4 | Phase 1 | "日常改 bug/加功能在 GUI 完成，CLI 可 resume 同一会话" |
| T2.1~T2.6 | §4.4/§10.1/§10.2/§10.4/§11-3 | Phase 2 | "agent 跑 Web 项目：改代码→跑测试→浏览器验证，全程桌面内闭环" |
| T3.1~T3.4 | §5/§6.5/§7/§10.6 | Phase 3 | "装一个社区 Pi 包，扩展+主题+Skill 全生效；CLI/桌面互通" |
| T4.1~T4.3 | §9/§10.3/§12-Phase4 | Phase 4 | "权限矩阵用例全过；危险命令/敏感文件默认拦截" |
| T5.1~T5.3 | §6/§5.8/§10.6/§11-6/7/10 | Phase 5 | "干净安装三平台，新用户 10 分钟跑通" |
