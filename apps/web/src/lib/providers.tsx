"use client";

import { Toaster } from "sonner";
import { ThemeProvider } from "../lib/theme-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              "rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] shadow-[var(--shadow)]",
            title: "text-sm font-medium",
            description: "text-xs text-[var(--muted)]",
          },
        }}
      />
    </ThemeProvider>
  );
}
