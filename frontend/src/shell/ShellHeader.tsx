import { Moon, Sun } from "lucide-react";

import { APP_NAME, APP_SUBTITLE, APP_VERSION } from "@/app/branding";
import type { ThemeMode } from "@/platform/ui/theme";
import { Button } from "@/shared/components/ui/button";

interface ShellHeaderProps {
  theme: ThemeMode;
  onThemeToggle: () => void;
  configSummary: string;
}

export function ShellHeader({ theme, onThemeToggle, configSummary }: ShellHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-card/80 px-4 py-3 backdrop-blur sm:px-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{APP_NAME}</h1>
            <span className="text-xs text-muted-foreground">v{APP_VERSION}</span>
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
