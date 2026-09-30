export const sceneIconOptions = [
  { key: "bed", label: "ベッド" },
  { key: "moon", label: "月" },
  { key: "sun", label: "太陽" },
  { key: "lightbulb", label: "電球" },
  { key: "lamp", label: "ランプ" },
  { key: "coffee", label: "コーヒー" },
  { key: "utensils", label: "食事" },
  { key: "door-open", label: "ドア" },
  { key: "lock", label: "鍵" },
  { key: "music", label: "音楽" },
  { key: "sparkles", label: "きらめき" },
  { key: "power", label: "電源" },
] as const;

export type SceneIcon = (typeof sceneIconOptions)[number]["key"];

export function validSceneIcon(value: unknown): value is SceneIcon {
  return typeof value === "string" && sceneIconOptions.some(option => option.key === value);
}

/** Existing definitions need no rewrite; the example rest scene gets a bed. */
export function sceneIcon(scene: { icon?: unknown; name: string }): SceneIcon {
  if (validSceneIcon(scene.icon)) return scene.icon;
  return ["休憩モード", "休息模式"].includes(scene.name.trim()) ? "bed" : "moon";
}
