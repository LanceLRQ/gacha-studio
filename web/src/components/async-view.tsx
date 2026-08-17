import { Inbox, Loader2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * 三个通用异步态展示——接入真实 IPC 后每个页面都会遇到「等待中 / 失败 /
 * 有数据但是空」这三种情况，集中在这里避免每个页面各写一份大同小异的
 * 占位 UI。空态与失败态刻意分开成两个组件：空库（一条记录都没有）是
 * 正常的首次使用状态，不是错误，不能用同一套"出错了"文案去引导用户。
 */
export function LoadingState({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      <span className="text-[12.5px]">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 py-16 text-center">
      <TriangleAlert className="size-5 text-destructive" />
      <p className="max-w-[420px] text-[12.5px] whitespace-pre-wrap text-destructive">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
      <Inbox className="size-6 text-faint-foreground" />
      <p className="text-[13px] font-medium">{title}</p>
      {description && <p className="max-w-[360px] text-[11.5px] text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
