/** Editor-only placement helpers. Saved geometry remains percentage based. */
export const POS_DISPLAY_GRID_STEP = 5;
type BlockGeometry = { x: number; y: number; width: number; height: number };

export function standbyCenterPosition(size: number): number {
  // Do not round: odd tenth-percent dimensions can require half-tenth positions.
  return (100 - size) / 2;
}

export function standbyCenteredAxes(block: BlockGeometry): { horizontal: boolean; vertical: boolean } {
  return {
    horizontal: Math.abs(block.x - standbyCenterPosition(block.width)) < 0.001,
    vertical: Math.abs(block.y - standbyCenterPosition(block.height)) < 0.001
  };
}

export function snapStandbyPosition(position: number, size: number, snap: boolean, centerThreshold = 1.5): number {
  const maximum = Math.max(0, 100 - size);
  if (position <= 0) return 0;
  if (position >= maximum) return maximum;
  const bounded = Math.max(0, Math.min(maximum, position));
  const center = standbyCenterPosition(size);
  if (snap && Math.abs(bounded - center) <= centerThreshold) return center;
  const placed = snap ? Math.round(bounded / POS_DISPLAY_GRID_STEP) * POS_DISPLAY_GRID_STEP : Math.round(bounded * 10) / 10;
  return Math.max(0, Math.min(maximum, placed));
}
