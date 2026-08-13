import { Moon, PanelRightClose, PanelRightOpen, Sun } from "lucide-react";

import { APP_NAME, APP_VERSION } from "@/app/branding";
import type { RuntimeMode } from "@/features/live/useMeterController";
import type { ThemeMode } from "@/platform/ui/theme";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import { ExportMenu, SettingsMenu, type HeaderMenuAction } from "./HeaderMenus";

export type HeaderStatusTone = "ok" | "error" | "normal";

interface ShellHeaderProps {
  theme: ThemeMode;
  onThemeToggle: () => void;
  configSummary: string;
  exportActions: HeaderMenuAction[];
  runtime: RuntimeMode;
  settingsActions: HeaderMenuAction[];
  statusText: string;
  statusTone: HeaderStatusTone;
  statusPulse?: boolean;
  showActivityPanel: boolean;
  onActivityPanelToggle: () => void;
}

export function ShellHeader({
  theme,
  onThemeToggle,
  configSummary,
  exportActions,
  runtime,
  settingsActions,
  statusText,
  statusTone,
  statusPulse = false,
  showActivityPanel,
  onActivityPanelToggle,
}: ShellHeaderProps) {
  return (
    <header className="relative z-40 shrink-0 border-b border-border bg-card/80 px-3 py-2 backdrop-blur sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-x-2.5">
          <div className="flex shrink-0 items-center gap-1.5">
            <h1 className="text-base font-semibold leading-none tracking-tight sm:text-lg">{APP_NAME}</h1>
            <span className="text-[10px] font-medium text-muted-foreground">v{APP_VERSION}</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                runtime === "desktop" && "border-success/30 bg-success/10 text-success-foreground",
                runtime === "browser" && "border-warning/40 bg-warning/10 text-warning-foreground",
                runtime === "checking" && "border-border bg-muted text-muted-foreground",
              )}
            >
              {runtime === "desktop" ? "Desktop" : runtime === "browser" ? "Demo" : "Connecting"}
            </span>
          </div>
          <p
            className="min-w-0 truncate font-mono text-[11px] leading-none text-muted-foreground/90"
            title={configSummary}
          >
            {configSummary}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
              statusTone === "ok" && "border-success/30 bg-success/10 text-success-foreground",
              statusTone === "error" && "border-destructive/30 bg-destructive/10 text-destructive-foreground",
              statusTone === "normal" && "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                statusTone === "ok" && "bg-success",
                statusTone === "error" && "bg-destructive",
                statusTone === "normal" && "bg-muted-foreground/60",
                statusPulse && "animate-pulse",
              )}
            />
            {statusText}
          </div>
          <Button
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={onThemeToggle}
            size="icon"
            variant="outline"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <SettingsMenu actions={settingsActions} />
          <ExportMenu actions={exportActions} />
          <Button
            aria-label={showActivityPanel ? "Hide log and sessions" : "Show log and sessions"}
            aria-pressed={showActivityPanel}
            onClick={onActivityPanelToggle}
            size="icon"
            title={showActivityPanel ? "Hide log & sessions" : "Show log & sessions"}
            variant={showActivityPanel ? "secondary" : "outline"}
          >
            {showActivityPanel ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
