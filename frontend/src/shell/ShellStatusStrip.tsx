import { cn } from "@/shared/lib/utils";

interface ShellStatusStripProps {
  message: string;
  tone?: "normal" | "error" | "ok";
}

export function ShellStatusStrip({ message, tone = "normal" }: ShellStatusStripProps) {
  return (
    <footer className="shrink-0 border-t border-border bg-card/60 px-4 py-1.5 sm:px-5">
      <p
        className={cn(
          "truncate text-xs",
          tone === "error" && "text-destructive-foreground",
          tone === "ok" && "text-success-foreground",
          tone === "normal" && "text-muted-foreground",
        )}
      >
        {message}
      </p>
    </footer>
  );
}
