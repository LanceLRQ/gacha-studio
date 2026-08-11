import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  );
}

/**
 * 卡池 tab 列表——界面设计方向 §4.7。允许横向溢出滚动但隐藏滚动条，
 * 不写死列数/宽度，新增卡池只是多一个 tab（§4.6 规避绝区零换行错位教训）。
 */
function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "-mb-px cursor-pointer border-b-2 border-transparent px-3.5 py-2 text-[12.5px] font-medium whitespace-nowrap text-muted-foreground outline-none",
        "hover:text-foreground",
        "data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-primary",
        "focus-visible:ring-2 focus-visible:ring-primary-tint",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
