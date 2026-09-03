import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// workspace 包以 TS 源码直连（不出 dist）：
// main/preload 侧 exclude 出 externalize 列表，由 esbuild 打进产物；
// renderer 侧 vite 原生编译链接的源码包。
const workspacePackages = ["@pi-wood/engine", "@pi-wood/ipc-schema", "@pi-wood/ui-kit", "@pi-wood/plugin-api"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "electron/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "electron/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: { "@": resolve(__dirname, "src/renderer/src") },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
