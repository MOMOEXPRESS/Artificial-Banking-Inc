import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-[family-name:var(--font-sans-stack)] font-semibold transition-[background,color,border-color,transform,filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-[0.42]",
  {
    variants: {
      variant: {
        default:
          "rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] border border-transparent",
        secondary:
          "rounded-[var(--radius-sm)] bg-[var(--color-seg-active-bg)] text-[var(--color-seg-active-fg)] border border-transparent hover:brightness-95",
        ghost:
          "rounded-[var(--radius-sm)] bg-[var(--color-surface-3)] text-[var(--color-fg)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]",
        outline:
          "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-surface-hover)]",
        bare: "rounded-[var(--radius-sm)] bg-transparent text-[var(--color-fg-muted)] border-none hover:text-[var(--color-fg)] px-2.5",
        destructive:
          "rounded-[var(--radius-sm)] bg-[var(--color-danger-soft)] text-[var(--color-danger)] border border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)] hover:brightness-110",
      },
      size: {
        default: "h-9 px-4 py-2 text-sm",
        sm: "h-8 px-3 text-xs rounded-[9px]",
        lg: "h-10 px-6 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
