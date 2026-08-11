import { Moon, Sun } from "lucide-react";

import { APP_NAME, APP_SUBTITLE, APP_VERSION } from "@/app/branding";
import type { ThemeMode } from "@/platform/ui/theme";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import type { RuntimeMode } from "@/features/live/useMeterController";

interface ShellHeaderProps {
  theme: ThemeMode;
  onThemeToggle: () => void;
  configSummary: string;
  runtime: RuntimeMode;
}

export function ShellHeader({ theme, onThemeToggle, configSummary, runtime }: ShellHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-card/80 px-4 py-3 backdrop-blur sm:px-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{APP_NAME}</h1>
            <span className="text-xs text-muted-foreground">v{APP_VERSION}</span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                runtime === "desktop" && "border-success/30 bg-success/10 text-success-foreground",
                runtime === "browser" && "border-warning/40 bg-warning/10 text-warning-foreground",
                runtime === "checking" && "border-border bg-muted text-muted-foreground",
              )}
            >
              {runtime === "desktop" ? "Desktop" : runtime === "browser" ? "Demo" : "Connecting"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{APP_SUBTITLE}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground/90" title={configSummary}>
            {configSummary}
          </p>
        </div>
        <Button
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={onThemeToggle}
          size="icon"
          variant="outline"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </div>
    </header>
  );
}
