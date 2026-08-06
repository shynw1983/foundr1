export const quickDashboardWidgetTypes = [
  "store_presence",
  "quick_shortage",
  "web_reservation",
  "today_sales",
  "active_orders",
  "purchase_pending"
] as const;

export type QuickDashboardWidgetType = typeof quickDashboardWidgetTypes[number];
export type QuickDashboardWidgetSize = "normal" | "wide";
export type QuickDashboardWidget = {
  id: string;
  type: QuickDashboardWidgetType;
  size: QuickDashboardWidgetSize;
};
export type QuickDashboardPreferences = {
  selectedStoreId?: string;
  widgets: QuickDashboardWidget[];
};

const widgetTypeSet = new Set<string>(quickDashboardWidgetTypes);

export const defaultQuickDashboardPreferences: QuickDashboardPreferences = {
  widgets: [
    { id: "store-presence", type: "store_presence", size: "wide" },
    { id: "quick-shortage", type: "quick_shortage", size: "normal" }
  ]
};

export function normalizeQuickDashboardPreferences(value: unknown): QuickDashboardPreferences {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const selectedStoreId = String(source.selectedStoreId ?? "").trim();
  const hasWidgetArray = Array.isArray(source.widgets);
  const rawWidgets = hasWidgetArray ? source.widgets as unknown[] : defaultQuickDashboardPreferences.widgets;
  const seenTypes = new Set<string>();
  const widgets = rawWidgets.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const type = String(raw.type ?? "");
    if (!widgetTypeSet.has(type) || seenTypes.has(type)) return [];
    seenTypes.add(type);
    return [{
      id: String(raw.id ?? "").trim().slice(0, 80) || `${type}-${index + 1}`,
      type: type as QuickDashboardWidgetType,
      size: (raw.size === "wide" || type === "store_presence" ? "wide" : "normal") as QuickDashboardWidgetSize
    }];
  }).slice(0, 8);

  return {
    ...(selectedStoreId ? { selectedStoreId } : {}),
    widgets: hasWidgetArray ? widgets : defaultQuickDashboardPreferences.widgets
  };
}
