import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export type DropdownAlign = "left" | "right";

interface DropdownPanelProps {
  align?: DropdownAlign;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function DropdownPanel({ align = "right", children, className, title }: DropdownPanelProps) {
  return (
    <div
      className={cn(
        "absolute z-50 mt-2 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-card p-1.5 text-card-foreground shadow-lg",
        align === "right" ? "right-0" : "left-0",
        className,
      )}
      role="menu"
    >
      {title ? (
        <div className="px-2.5 py-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        </div>
      ) : null}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

interface DropdownItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function DropdownItem({ active = false, className, type = "button", ...props }: DropdownItemProps) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        "text-foreground hover:bg-accent/60",
        active ? "bg-accent/70 font-medium" : null,
        props.disabled ? "cursor-not-allowed opacity-50 hover:bg-transparent" : null,
        className,
      )}
      role="menuitem"
      type={type}
      {...props}
    />
  );
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />;
}
