import { Navigate, Outlet } from "react-router-dom";

import { Sidebar } from "@/layouts/Sidebar";
import { useAppState } from "@/lib/app-state";

/**
 * App Shell —— 界面设计方向 §4.8：外框架占满窗口，内容不得超出外框架。
 *
 * 侧栏、顶部工具栏、页面 tab、操作按钮固定不随内容滚动；记录列表/分析图表
 * 各自在独立容器内滚动；整页/外框架本身不出现滚动条。
 *
 * ⚠️ min-height: 0 约束在这一层落实两处：
 * 1. 根容器 `h-screen w-screen overflow-hidden` —— 保证外框架本身不产生滚动条；
 * 2. `.main` 容器 `min-h-0 min-w-0` —— flex 子项默认 min-height/min-width: auto，
 *    会被内容撑破导致 overflow 失效、滚动条跑到最外层，这里必须显式清零。
 *    子路由页面（Overview/GameDetail/Records/Settings）在此基础上还要自己
 *    再声明一层 `min-h-0`，见各页面文件头部注释——组件嵌套层级和原 demo 不同，
 *    不能假设这里清零一次就传导到底。
 */
export function AppShell() {
  const { hasOnboarded } = useAppState();
  if (!hasOnboarded) {
    return <Navigate to="/welcome" replace />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
