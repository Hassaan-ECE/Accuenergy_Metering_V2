import { useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, X } from "lucide-react";

import { DEFAULT_CONFIG, type AppConfig, validateConfig } from "@/features/live/types";
import type { PortInfo } from "@/integrations/tauri/meterBridge";
import { Button } from "@/shared/components/ui/button";

interface SettingsDialogProps {
  config: AppConfig;
  ports: PortInfo[];
  refreshingPorts: boolean;
  saving: boolean;
  onClose: () => void;
  onRefreshPorts: () => void;
  onSave: (config: AppConfig) => Promise<void>;
}

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

function numberValue(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

export function SettingsDialog({
  config,
  ports,
  refreshingPorts,
  saving,
  onClose,
  onRefreshPorts,
  onSave,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState<AppConfig>(config);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const portOptions = useMemo(
    () => ports.map((port) => ({ ...port, label: port.description ? `${port.name} — ${port.description}` : port.name })),
    [ports],
  );

  const update = <Key extends keyof AppConfig>(key: Key, value: AppConfig[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = async () => {
    const normalized = { ...draft, port: draft.port.trim(), parity: draft.parity.toUpperCase() as AppConfig["parity"] };
    const validationError = validateConfig(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      await onSave(normalized);
    } catch (saveError) {
      setError(String(saveError));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div
        aria-labelledby="settings-title"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold" id="settings-title">Meter settings</h2>
            <p className="mt-1 text-sm text-muted-foreground">Communication, sampling, and SQLite batching.</p>
          </div>
          <Button aria-label="Close settings" disabled={saving} onClick={onClose} size="icon" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>

        <div className="max-h-[calc(92vh-132px)] overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">COM port</span>
              <div className="flex gap-2">
                <input
                  className={fieldClass}
                  list="serial-port-options"
                  onChange={(event) => update("port", event.target.value)}
                  placeholder="COM5"
                  value={draft.port}
                />
                <datalist id="serial-port-options">
                  {portOptions.map((port) => <option key={port.name} value={port.name}>{port.label}</option>)}
                </datalist>
                <Button disabled={refreshingPorts} onClick={onRefreshPorts} variant="outline">
                  <RefreshCw className={refreshingPorts ? "size-4 animate-spin" : "size-4"} />
                  Refresh
                </Button>
              </div>
              <span className="block text-xs text-muted-foreground">
                {ports.length ? `${ports.length} serial port${ports.length === 1 ? "" : "s"} detected; free-text is also accepted.` : "No ports detected; enter a COM name manually."}
              </span>
            </label>

            <NumberField label="Baud rate" min={1} onChange={(value) => update("baudrate", value)} step={1} value={draft.baudrate} />
            <NumberField label="Device ID" max={247} min={1} onChange={(value) => update("deviceId", value)} step={1} value={draft.deviceId} />

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parity</span>
              <select className={fieldClass} onChange={(event) => update("parity", event.target.value as AppConfig["parity"])} value={draft.parity}>
                <option value="N">None (N)</option>
                <option value="E">Even (E)</option>
                <option value="O">Odd (O)</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stop bits</span>
              <select className={fieldClass} onChange={(event) => update("stopBits", Number(event.target.value) as 1 | 2)} value={draft.stopBits}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>

            <NumberField help="0 reads as fast as the meter and adapter allow." label="Sample rate (Hz)" min={0} onChange={(value) => update("sampleHz", value)} step={0.1} value={draft.sampleHz} />
            <NumberField help="0 runs until Stop is requested." label="Run duration (hours)" min={0} onChange={(value) => update("runHours", value)} step={0.25} value={draft.runHours} />
            <NumberField label="Commit every (samples)" min={1} onChange={(value) => update("commitEvery", value)} step={1} value={draft.commitEvery} />
            <NumberField label="Timeout (seconds)" min={0.1} onChange={(value) => update("timeoutSeconds", value)} step={0.1} value={draft.timeoutSeconds} />
            <NumberField label="Retries" min={0} onChange={(value) => update("retries", value)} step={1} value={draft.retries} />
          </div>

          <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
            Lab defaults: COM5 · device 1 · 19200 baud · 8N1 · 1 Hz · 24 hours.
          </div>
          {error ? <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <Button disabled={saving} onClick={() => setDraft({ ...DEFAULT_CONFIG, themeName: draft.themeName })} variant="ghost">
            <RotateCcw className="size-4" />
            Restore defaults
          </Button>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={onClose} variant="outline">Cancel</Button>
            <Button disabled={saving} onClick={submit}>{saving ? "Saving…" : "Save settings"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface NumberFieldProps {
  help?: string;
  label: string;
  max?: number;
  min: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

function NumberField({ help, label, max, min, step, value, onChange }: NumberFieldProps) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        className={fieldClass}
        max={max}
        min={min}
        onChange={(event) => onChange(numberValue(event.target.value))}
        step={step}
        type="number"
        value={Number.isNaN(value) ? "" : value}
      />
      {help ? <span className="block text-xs text-muted-foreground">{help}</span> : null}
    </label>
  );
}
