"use client";

import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-3)]", className)} {...props} />;
}

export function ConsoleSkeleton() {
  return (
    <div className="view">
      <div className="grid g-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} style={{ height: 104 }} />
        ))}
      </div>
      <div className="grid g-main fill">
        <Skeleton style={{ minHeight: 320 }} />
        <Skeleton style={{ minHeight: 320 }} />
      </div>
    </div>
  );
}
