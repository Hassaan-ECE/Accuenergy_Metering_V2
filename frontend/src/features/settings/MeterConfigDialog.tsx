import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck, X } from "lucide-react";

import type {
  AppConfig,
  ApplyMeterDefaultsRequest,
  MeterCommSettings,
  MeterConfigPreview,
} from "@/features/live/types";
import { Button } from "@/shared/components/ui/button";

interface MeterConfigDialogProps {
  action: "idle" | "preview" | "apply";
  config: AppConfig;
  preview: MeterConfigPreview | null;
  onApply: (request: ApplyMeterDefaultsRequest) => Promise<boolean>;
  onClose: () => void;
  onPreview: (targetDeviceId: number, targetBaudrate: number) => Promise<MeterConfigPreview | null>;
}

const fieldClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export function MeterConfigDialog({ action, config, preview, onApply, onClose, onPreview }: MeterConfigDialogProps) {
  const [targetDeviceId, setTargetDeviceId] = useState(1);
  const [targetBaudrate, setTargetBaudrate] = useState(19_200);
  const [isolated, setIsolated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = action !== "idle";
  const previewMatches =
    preview?.after.deviceId === targetDeviceId && preview.after.baudrate === targetBaudrate;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const validateTarget = () => {
    if (!Number.isInteger(targetDeviceId) || targetDeviceId < 1 || targetDeviceId > 247) {
      return "Target device ID must be between 1 and 247.";
    }
    if (!Number.isInteger(targetBaudrate) || targetBaudrate < 1 || targetBaudrate > 65_535) {
      return "Target baud rate must be between 1 and 65535.";
    }
    return null;
  };

  const readPreview = async () => {
    const validationError = validateTarget();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    await onPreview(targetDeviceId, targetBaudrate);
  };

  const apply = async () => {
    const validationError = validateTarget();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!previewMatches) {
      setError("Read the meter again to refresh the dry-run preview for this target.");
      return;
    }
    if (!isolated) {
      setError("Confirm that this meter is isolated from the RS485 daisy chain before applying.");
      return;
    }
    setError(null);
    const applied = await onApply({ targetDeviceId, targetBaudrate, isolated });
    if (applied) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        aria-labelledby="meter-config-title"
        aria-modal="true"
        className="max-h-[94vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold" id="meter-config-title">Configure meter communication</h2>
            <p className="mt-1 text-sm text-muted-foreground">Read, preview, write, and verify the meter's RS485 registers.</p>
          </div>
          <Button aria-label="Close meter configuration" disabled={busy} onClick={onClose} size="icon" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>

        <div className="max-h-[calc(94vh-132px)] overflow-y-auto px-5 py-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-muted/25 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current connection</p>
              <p className="mt-2 font-mono text-sm">{config.port} · device {config.deviceId} · {config.baudrate} baud · 8{config.parity}{config.stopBits}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                The dry-run and write use these saved settings. If they are wrong, update Settings first; automatic scanning is not part of this pass.
              </p>
            </section>

            <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exact legacy block</p>
              <p className="mt-2 font-mono text-sm">Holding 0x0FFE × 5 · read FC 03H · write FC 10H</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Protocol → Modbus, parity → Non1 (8N1), password preserved, then target ID and baud.
              </p>
            </section>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target meter role / ID</span>
              <select
                className={fieldClass}
                disabled={busy}
                onChange={(event) => {
                  setTargetDeviceId(Number(event.target.value));
                  setError(null);
                }}
                value={targetDeviceId}
              >
                <option value={1}>Meter 1 · device ID 1</option>
                <option value={2}>Meter 2 · device ID 2</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Target baud rate</span>
              <input
                className={fieldClass}
                disabled={busy}
                max={65_535}
                min={1}
                onChange={(event) => {
                  setTargetBaudrate(Number(event.target.value));
                  setError(null);
                }}
                step={1}
                type="number"
                value={targetBaudrate}
              />
            </label>
          </div>

          <section className="mt-4 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Dry-run register preview</p>
                <p className="mt-1 text-xs text-muted-foreground">A fresh FC03 read is required before Apply is enabled.</p>
              </div>
              <Button disabled={busy} onClick={readPreview} size="sm" variant="outline">
                <RefreshCw className={action === "preview" ? "size-4 animate-spin" : "size-4"} />
                {action === "preview" ? "Reading…" : "Read & preview"}
              </Button>
            </div>
            {preview ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <RegisterCard label="Before" settings={preview.before} />
                <RegisterCard label="After" settings={preview.after} />
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {action === "preview" ? "Reading 0x0FFE–0x1002…" : "No successful meter settings read yet."}
              </div>
            )}
            {preview && !previewMatches ? (
              <p className="mt-3 text-xs font-medium text-warning-foreground">Target changed; run Read & preview again before applying.</p>
            ) : null}
          </section>

          <label className="mt-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <input
              checked={isolated}
              className="mt-1 size-4 accent-primary"
              disabled={busy}
              onChange={(event) => {
                setIsolated(event.target.checked);
                setError(null);
              }}
              type="checkbox"
            />
            <span>
              <span className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4" /> I isolated this meter on the bus</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                Isolate this meter from the daisy chain before applying, or both meters may conflict when IDs change.
              </span>
            </span>
          </label>

          {error ? <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="hidden text-xs text-muted-foreground sm:block">App settings update only after the target connection verifies.</p>
          <div className="ml-auto flex gap-2">
            <Button disabled={busy} onClick={onClose} variant="outline">Cancel</Button>
            <Button disabled={busy || !isolated || !previewMatches} onClick={apply}>
              <ShieldCheck className={action === "apply" ? "size-4 animate-pulse" : "size-4"} />
              {action === "apply" ? "Writing & verifying…" : "Apply & verify"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RegisterCard({ label, settings }: { label: string; settings: MeterCommSettings }) {
  const registers = [settings.protocol, settings.parityCode, settings.password, settings.deviceId, settings.baudrate];
  return (
    <div className="rounded-lg border border-border bg-muted/25 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 break-all font-mono text-sm">[{registers.join(", ")}]</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Protocol</dt><dd className="text-right font-mono">{settings.protocol}</dd>
        <dt className="text-muted-foreground">Parity code</dt><dd className="text-right font-mono">{settings.parityCode}</dd>
        <dt className="text-muted-foreground">Password</dt><dd className="text-right font-mono">{settings.password} (preserved)</dd>
        <dt className="text-muted-foreground">Device ID</dt><dd className="text-right font-mono">{settings.deviceId}</dd>
        <dt className="text-muted-foreground">Baud</dt><dd className="text-right font-mono">{settings.baudrate}</dd>
      </dl>
    </div>
  );
}
