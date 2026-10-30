"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "../lib/theme-provider";

function ThemedToaster() {
  const { resolved } = useTheme();
  // The console pins the Ask ABI launcher bottom-right (and a tab bar on
  // phones). Toasts stack above it there instead of landing on top of it.
  const inConsole = usePathname()?.startsWith("/console") ?? false;
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      offset={inConsole ? { bottom: 78, right: 24 } : undefined}
      mobileOffset={
        inConsole ? { bottom: "calc(max(10px, env(safe-area-inset-bottom)) + 132px)" } : undefined
      }
      toastOptions={{
        classNames: {
          toast:
            "rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] shadow-[var(--shadow)]",
          title: "text-sm font-medium",
          description: "text-xs text-[var(--muted)]",
        },
      }}
    />
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <ThemedToaster />
    </ThemeProvider>
  );
}
