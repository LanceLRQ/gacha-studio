import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 卡片族组件。层级实现靠底色深浅 + 细边框，不使用 shadow-lg 类的浮起效果
 * （界面设计方向 §2.2 规定 2）。
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-2.5 rounded-md border border-border bg-card px-4 py-3.5 text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex items-center gap-2.5", className)}
      {...props}
    />
  );
}

function CardTitleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title-group"
      className={cn("flex flex-col leading-snug", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-[13.5px] font-semibold", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-[11.5px] text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn(className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "mt-1 flex justify-end gap-2 border-t border-border pt-2.5",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitleGroup,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
