# pi-wood

以 Pi Coding Agent（`@earendil-works/pi-coding-agent`）为唯一内核的桌面 Agent 工作台。

- 产品与技术方案：`../PiAgent-Desktop-Workbench-方案.md`（v2.2）
- 执行计划与追溯：`../pi-wood-执行计划.md`（任务号 T{Phase}.{seq}，commit 前缀引用任务号）

## 常用命令

```bash
pnpm install        # 安装全部依赖
pnpm dev            # 启动开发窗口（Electron + Vite 热更新）
pnpm typecheck      # 全 workspace 类型检查
pnpm build          # 构建（electron-vite build）
pnpm package        # 打 Windows NSIS 安装包（release/）
```

## 结构

```
apps/desktop        # Electron 应用（main / preload / renderer 三栏 UI）
packages/engine     # EngineAdapter 接口 + SDK 实现（Pi 内核适配层）
packages/ipc-schema # 全部 IPC 通道的 zod 契约（主/渲染共用）
packages/ui-kit     # 三栏组件库 + cn() + 主题变量（T1.2 起填充）
```
