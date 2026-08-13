import type { ReactNode } from "react";
import { Download, Settings2 } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { DropdownItem, DropdownPanel, DropdownSeparator } from "@/shared/components/ui/dropdown-menu";
import { useDropdownMenu } from "@/shared/hooks/useDropdownMenu";

export interface HeaderMenuAction {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  separatorBefore?: boolean;
}

interface HeaderMenuProps {
  actions: HeaderMenuAction[];
  ariaLabel: string;
  icon: ReactNode;
  title: string;
}

function HeaderMenu({ actions, ariaLabel, icon, title }: HeaderMenuProps) {
  const { open, menuRef, toggle, close } = useDropdownMenu();

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        onClick={toggle}
        size="icon"
        title={ariaLabel}
        variant="outline"
      >
        {icon}
      </Button>
      {open ? (
        <DropdownPanel align="right" className="w-52" title={title}>
          {actions.map((action) => (
            <div key={action.label}>
              {action.separatorBefore ? <DropdownSeparator /> : null}
              <DropdownItem
                disabled={action.disabled}
                onClick={() => {
                  if (action.disabled) return;
                  close();
                  action.onClick();
                }}
              >
                {action.icon}
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
              </DropdownItem>
            </div>
          ))}
        </DropdownPanel>
      ) : null}
    </div>
  );
}

interface ExportMenuProps {
  actions: HeaderMenuAction[];
}

export function ExportMenu({ actions }: ExportMenuProps) {
  return (
    <HeaderMenu
      actions={actions}
      ariaLabel="Export & load"
      icon={<Download className="size-4" />}
      title="Export & load"
    />
  );
}

interface SettingsMenuProps {
  actions: HeaderMenuAction[];
}

export function SettingsMenu({ actions }: SettingsMenuProps) {
  return (
    <HeaderMenu
      actions={actions}
      ariaLabel="Settings"
      icon={<Settings2 className="size-4" />}
      title="Settings"
    />
  );
}
