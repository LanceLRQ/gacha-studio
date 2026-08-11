import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";

// 西文字体自托管，不走 Google Fonts CDN（桌面客户端离线优先，运行时拉字体
// 会在断网时闪烁），也不退回系统字体——界面设计方向 §2.2 规定 4 把「display
// 字体不用 Inter / 系统默认」列在「不得放弃」的四条里。
// 只引拉丁子集的必要字重，实测 5 个字重共 120KB；中文不打包、由下方
// theme.css 的 --font-ui 兜底链回落到系统字体（微软雅黑 / 苹方）——
// 中文字体 2~5MB 的体积顾虑在西文上差两个数量级，两条约束可以同时满足。
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";

import { App } from "./App";
import { AppStateProvider } from "./lib/app-state";
import { ThemeProvider } from "./lib/theme-provider";
import "./styles/theme.css";

// 用 HashRouter 而非 BrowserRouter：桌面应用的前端产物由 Tauri 以静态文件
// 形式提供，没有服务端路由回退——hash 路由天然避免刷新/深链接时的 404。
const container = document.getElementById("root");
if (!container) {
  throw new Error("未找到挂载节点 #root");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <AppStateProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </AppStateProvider>
    </ThemeProvider>
  </StrictMode>,
);
