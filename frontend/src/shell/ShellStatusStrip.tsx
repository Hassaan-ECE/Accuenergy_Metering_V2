import { APP_CREDIT } from "@/app/branding";
import { cn } from "@/shared/lib/utils";

interface ShellStatusStripProps {
  message: string;
  tone?: "normal" | "error" | "ok";
}

export function ShellStatusStrip({ message, tone = "normal" }: ShellStatusStripProps) {
  return (
    <footer className="relative shrink-0 border-t border-border bg-card/60 px-3 text-xs sm:px-4">
      <div className="flex items-center overflow-hidden py-1 pr-40">
        <p
          className={cn(
            "min-w-0 truncate",
            tone === "error" && "text-destructive-foreground",
            tone === "ok" && "text-success-foreground",
            tone === "normal" && "text-muted-foreground",
          )}
        >
          {message}
        </p>
      </div>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-medium text-muted-foreground sm:right-4">
        {APP_CREDIT}
      </span>
    </footer>
  );
}
