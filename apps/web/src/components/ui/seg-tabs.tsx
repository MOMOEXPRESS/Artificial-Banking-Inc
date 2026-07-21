"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Pill segment control — neutral grey active pill (never accent blue). */
export function SegTabs({
  value,
  onValueChange,
  items,
  className,
  listClassName,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly { value: string; label: React.ReactNode }[];
  className?: string;
  listClassName?: string;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <TabsList
        className={cn(
          "h-auto inline-flex flex-wrap gap-0.5 rounded-full border-0 bg-[var(--color-surface-3)] p-[3px] text-[var(--color-fg-muted)] shadow-none",
          listClassName,
        )}
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            className={cn(
              "rounded-full px-[15px] py-1.5 text-[12.5px] font-medium shadow-none",
              "bg-transparent text-[var(--color-fg-muted)]",
              "data-[state=active]:bg-[var(--color-seg-active-bg)] data-[state=active]:text-[var(--color-seg-active-fg)] data-[state=active]:font-semibold data-[state=active]:shadow-none",
            )}
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
