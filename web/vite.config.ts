import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 端口与构建产物目录是与 Tauri 宿主的固定契约（src-tauri/tauri.conf.json），不得随意更改。
export default defineConfig({
  plugins: [react()],
  // Tauri dev 会在同一个终端里同时输出 cargo 日志，避免 Vite 清屏盖掉这些信息。
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
