import { Pause, Play } from "lucide-react";

export function InventoryActionBadge({ available, label }: { available: boolean; label: string }) {
  const Icon = available ? Play : Pause;
  return (
    <span className={`store-inventory-action-badge is-${available ? "available" : "unavailable"}`} data-i18n-ignore>
      <Icon size={16} aria-hidden="true" />
      {label}
    </span>
  );
}
