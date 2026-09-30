import { BedDouble, Coffee, DoorOpen, Lamp, Lightbulb, LockKeyhole, Moon, Music, Power, Sparkles, Sun, Utensils, type LucideIcon } from "lucide-react";
import type { SceneIcon } from "../../../lib/store-scene-icons";

const icons: Record<SceneIcon, LucideIcon> = {
  bed: BedDouble, moon: Moon, sun: Sun, lightbulb: Lightbulb, lamp: Lamp,
  coffee: Coffee, utensils: Utensils, "door-open": DoorOpen, lock: LockKeyhole,
  music: Music, sparkles: Sparkles, power: Power,
};

export function StoreSceneIcon({ icon, size = 20 }: { icon: SceneIcon; size?: number }) {
  const Icon = icons[icon];
  return <Icon size={size} aria-hidden="true"/>;
}
