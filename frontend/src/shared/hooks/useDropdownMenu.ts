import { useCallback, useEffect, useRef, useState } from "react";

interface UseDropdownMenuOptions {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function useDropdownMenu({ open: controlledOpen, onOpenChange }: UseDropdownMenuOptions = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const menuRef = useRef<HTMLDivElement | null>(null);

  const setOpen = useCallback(
    (next: boolean): void => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  return {
    open,
    setOpen,
    menuRef,
    toggle: () => setOpen(!open),
    close: () => setOpen(false),
  };
}
