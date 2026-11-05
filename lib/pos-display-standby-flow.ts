/** Geometry for a repeating horizontal welcome field. All dimensions are pixels. */
export type PosDisplayStandbyFlowMetric = { index: number; width: number; height: number };
export type PosDisplayStandbyFlowPlacement = PosDisplayStandbyFlowMetric & { x: number; y: number };
export type PosDisplayStandbyFlowLayout = { tileWidth: number; height: number; words: PosDisplayStandbyFlowPlacement[] };
export type PosDisplayStandbyFlowLayer = PosDisplayStandbyFlowLayout & { id: number; speedMultiplier: number };
export type PosDisplayStandbyFlowScene = {
  mode: 'uniform' | 'layered';
  fallbackReason: 'insufficient-height' | 'single-phrase' | null;
  density: number;
  densityLimited: boolean;
  layers: PosDisplayStandbyFlowLayer[];
};
type FlowInput = { width: number; height: number; words: PosDisplayStandbyFlowMetric[]; seed: string };
type Corridor = { dense: PosDisplayStandbyFlowLayout; baselineWidth: number; depth: number };
export type PosDisplayStandbyFlowGeometry = {
  screenWidth: number;
  height: number;
  baseline: PosDisplayStandbyFlowLayout;
  dense: PosDisplayStandbyFlowLayout;
  corridors: Corridor[] | null;
  fallbackReason: 'insufficient-height' | 'single-phrase' | null;
};
type Rectangle = { x: number; y: number; width: number; height: number };

export function posDisplayStandbyFlowSeed(seed: string, offset: number) {
  let value = 2166136261;
  for (const char of `${seed}:${offset}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function intersects(a: Rectangle, b: Rectangle) {
  return a.x < b.x + b.width - .01 && a.x + a.width > b.x + .01 && a.y < b.y + b.height - .01 && a.y + a.height > b.y + .01;
}
function contains(a: Rectangle, b: Rectangle) {
  return a.x <= b.x + .01 && a.y <= b.y + .01 && a.x + a.width >= b.x + b.width - .01 && a.y + a.height >= b.y + b.height - .01;
}
function cutFreeRectangles(free: Rectangle[], used: Rectangle) {
  const split: Rectangle[] = [];
  for (const rectangle of free) {
    if (!intersects(rectangle, used)) { split.push(rectangle); continue; }
    const right = rectangle.x + rectangle.width, bottom = rectangle.y + rectangle.height;
    if (used.x > rectangle.x) split.push({ ...rectangle, width: used.x - rectangle.x });
    if (used.x + used.width < right) split.push({ ...rectangle, x: used.x + used.width, width: right - used.x - used.width });
    if (used.y > rectangle.y) split.push({ ...rectangle, height: used.y - rectangle.y });
    if (used.y + used.height < bottom) split.push({ ...rectangle, y: used.y + used.height, height: bottom - used.y - used.height });
  }
  return split.filter((rectangle, index) => rectangle.width > .1 && rectangle.height > .1 && !split.some((other, otherIndex) =>
    otherIndex !== index && contains(other, rectangle) && (!contains(rectangle, other) || otherIndex < index)));
}

/** Seeded max-rect packing uses real shaped text boxes, rather than a lane/grid. */
export function createPosDisplayStandbyFlowLayout({ width, height, words, seed }: {
  width: number; height: number; words: PosDisplayStandbyFlowMetric[]; seed: string;
}): PosDisplayStandbyFlowLayout {
  const screenWidth = Math.max(1, width), bandHeight = Math.max(1, height);
  // Each width attempt reuses the same choices; avoid rehashing the full authored
  // text for repeated sort comparisons and later packing attempts.
  const randomValues = new Map<number, number>();
  const random = (offset: number) => {
    const previous = randomValues.get(offset);
    if (previous !== undefined) return previous;
    const value = posDisplayStandbyFlowSeed(seed, offset);
    randomValues.set(offset, value);
    return value;
  };
  const metrics = words.slice(0, 12).map(word => ({ ...word, width: Math.max(1, word.width), height: Math.max(1, word.height) }));
  const gap = Math.max(5, Math.min(11, bandHeight * .035));
  const boxes = metrics.map(word => {
    const horizontalGap = gap * (1.3 + random(word.index + 30) * .8);
    const verticalGap = gap * (.9 + random(word.index + 50) * .6);
    const boxHeight = Math.min(bandHeight, word.height + verticalGap);
    return { ...word, boxWidth: word.width + horizontalGap, boxHeight,
      insetX: horizontalGap / 2,
      insetY: word.height > bandHeight ? (bandHeight - word.height) / 2 : (boxHeight - word.height) / 2 };
  });
  let tileWidth = Math.max(screenWidth, ...boxes.map(word => word.boxWidth));
  for (let expansion = 0; expansion < 20; expansion++) {
    for (let trial = 0; trial < 96; trial++) {
      let free: Rectangle[] = [{ x: 0, y: 0, width: tileWidth, height: bandHeight }];
      const placed: PosDisplayStandbyFlowPlacement[] = [];
      // Try free scatter first. Before widening the repeat, also try compact
      // corner packings with several ordering/fit heuristics; random interior
      // placements can otherwise strand usable space between large words.
      const compact = trial >= 24;
      const strategy = (trial - 24) % 6;
      const sorted = [...boxes].sort((a, b) => {
        const score = (word: typeof a) => !compact ? word.boxWidth * word.boxHeight * (.8 + .4 * random(trial * 97 + word.index + 70))
          : strategy === 0 ? word.boxHeight : strategy === 1 ? word.boxWidth : strategy === 2 ? word.boxWidth * word.boxHeight
            : strategy === 3 ? Math.max(word.boxWidth, word.boxHeight) : strategy === 4 ? word.boxWidth + word.boxHeight
              : random(trial * 97 + word.index + 70);
        return score(b) - score(a);
      });
      for (const word of sorted) {
        const candidates = free.filter(rectangle => rectangle.width >= word.boxWidth && rectangle.height >= word.boxHeight)
          .sort((a, b) => {
            const score = (rectangle: Rectangle) => compact && Math.floor((trial - 24) / 6) % 3 === 1
              ? Math.min(rectangle.width - word.boxWidth, rectangle.height - word.boxHeight)
              : compact && Math.floor((trial - 24) / 6) % 3 === 2 ? rectangle.y + word.boxHeight
                : rectangle.width * rectangle.height - word.boxWidth * word.boxHeight;
            return score(a) - score(b);
          });
        const available = candidates[0];
        if (!available) break;
        const horizontal = random(trial * 101 + word.index + 100);
        const vertical = random(trial * 109 + word.index + 150);
        const inset = (space: number, random: number) => !compact ? space * random
          : random > .5 ? space - Math.min(space, gap * .3) * (random - .5) * 2 : Math.min(space, gap * .3) * random * 2;
        const used: Rectangle = { x: available.x + inset(available.width - word.boxWidth, horizontal),
          y: available.y + inset(available.height - word.boxHeight, vertical), width: word.boxWidth, height: word.boxHeight };
        placed.push({ index: word.index, width: word.width, height: word.height, x: used.x + word.insetX, y: used.y + word.insetY });
        free = cutFreeRectangles(free, used);
      }
      if (placed.length === metrics.length) return { tileWidth, height: bandHeight, words: placed.sort((a, b) => a.index - b.index) };
    }
    tileWidth *= 1.12;
  }
  // An exceptionally short band or many long custom phrases can require a wider
  // repeating field. Keep exact authored sizes; this fallback never shrinks text.
  let x = 0;
  const placed = boxes.map(word => {
    const placement = { index: word.index, width: word.width, height: word.height, x: x + word.insetX, y: (bandHeight - word.height) / 2 };
    x += word.boxWidth;
    return placement;
  });
  return { tileWidth: Math.max(screenWidth, x), height: bandHeight, words: placed };
}

/**
 * Speed layers occupy permanently disjoint vertical corridors. Words may have
 * different Y offsets within a corridor, but never cross its boundary, so no
 * relative animation phase can make two different-speed layers collide.
 */
function createCorridors(input: FlowInput, baselineWidth: number): Corridor[] | null {
  const { width, height, seed } = input;
  const metrics = input.words.slice(0, 12).map(word => ({ ...word, width: Math.max(1, word.width), height: Math.max(1, word.height) }));
  if (metrics.length < 2) return null;
  const ordered = [...metrics].sort((a, b) => b.height - a.height || b.width - a.width || a.index - b.index);
  const gap = Math.max(2, Math.min(6, height * .02));
  const random = (offset: number) => posDisplayStandbyFlowSeed(seed, offset);
  let selected: PosDisplayStandbyFlowMetric[][] | null = null;
  for (let count = Math.min(3, metrics.length); count >= 2 && !selected; count--) {
    let bestScore = Infinity;
    function consider(cuts: number[]) {
      const bounds = [0, ...cuts, ordered.length];
      const groups = bounds.slice(0, -1).map((start, index) => ordered.slice(start, bounds[index + 1]));
      const required = groups.reduce((sum, group) => sum + group[0].height, 0) + gap * count;
      if (required > height + .01) return;
      const widths = groups.map(group => group.reduce((sum, word) => sum + word.width + gap * 2, 0));
      const average = widths.reduce((sum, value) => sum + value, 0) / count;
      const score = widths.reduce((sum, value) => sum + Math.abs(value - average), 0) / Math.max(1, average)
        + groups.reduce((sum, group) => sum + Math.abs(group.length - metrics.length / count), 0) * .12;
      if (score < bestScore) { bestScore = score; selected = groups; }
    }
    if (count === 2) for (let first = 1; first < ordered.length; first++) consider([first]);
    else for (let first = 1; first < ordered.length - 1; first++) {
      for (let second = first + 1; second < ordered.length; second++) consider([first, second]);
    }
  }
  if (!selected) return null;
  // Group membership follows real height, while physical order is seeded so the
  // result does not turn into large/medium/small rows in a fixed top-down order.
  const groups: PosDisplayStandbyFlowMetric[][] = selected;
  const sequence = groups.map((group, index) => ({ group, depth: groups.length === 2 ? index === 0 ? 1 : -1 : 1 - index, index }))
    .sort((a, b) => random(a.index + 410) - random(b.index + 410));
  const intrinsic = sequence.reduce((sum, { group }) => sum + group[0].height, 0);
  const slack = Math.max(0, height - intrinsic - gap * sequence.length);
  const weights = sequence.map(({ index }) => .8 + random(index + 440) * .4);
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  let top = gap / 2;
  return sequence.map(({ group, depth, index: groupIndex }, layerIndex) => {
    const corridorHeight = group[0].height + slack * weights[layerIndex] / weightSum;
    const orderedWords = [...group].sort((a, b) => random(a.index + 470) - random(b.index + 470));
    let x = 0;
    const placed = orderedWords.map(word => {
      const horizontalGap = gap * (1.8 + random(word.index + 500) * 1.2);
      const placement = { ...word, x: x + horizontalGap / 2,
        y: top + Math.max(0, corridorHeight - word.height) * (.08 + random(word.index + groupIndex * 17 + 530) * .84) };
      x += word.width + horizontalGap;
      return placement;
    });
    const denseWidth = Math.max(width / 1.8, x);
    // Stretch only origins and the repeat interval, never shaped glyph widths.
    const stretch = denseWidth / Math.max(1, x);
    const dense = { tileWidth: denseWidth, height, words: placed.map(word => ({ ...word, x: word.x * stretch })) };
    top += corridorHeight + gap;
    return { dense, baselineWidth: Math.max(baselineWidth, denseWidth), depth };
  });
}

/** Prepare expensive text packing only when text, font metrics or bounds change. */
export function preparePosDisplayStandbyFlowGeometry(input: FlowInput): PosDisplayStandbyFlowGeometry {
  const screenWidth = Math.max(1, input.width), height = Math.max(1, input.height);
  const normalized = { ...input, width: screenWidth, height };
  const baseline = createPosDisplayStandbyFlowLayout(normalized);
  const candidate = createPosDisplayStandbyFlowLayout({ ...normalized, width: screenWidth / 1.8 });
  const dense = candidate.tileWidth < baseline.tileWidth ? candidate : baseline;
  const corridors = createCorridors(normalized, baseline.tileWidth);
  return { screenWidth, height, baseline, dense, corridors,
    fallbackReason: corridors ? null : input.words.length < 2 ? 'single-phrase' : 'insufficient-height' };
}

function withDensity(dense: PosDisplayStandbyFlowLayout, baselineWidth: number, density: number) {
  const requestedWidth = baselineWidth * 100 / density;
  const tileWidth = Math.max(dense.tileWidth, requestedWidth);
  const stretch = tileWidth / dense.tileWidth;
  return { limited: tileWidth > requestedWidth + .01,
    layout: { ...dense, tileWidth, words: dense.words.map(word => ({ ...word, x: word.x * stretch })) } };
}

/**
 * Resolve controls without repacking. Increasing density can only shorten the
 * repeat interval until exact-size text reaches its physical packing limit.
 */
export function resolvePosDisplayStandbyFlowScene(geometry: PosDisplayStandbyFlowGeometry, settings: { density?: number; speedVariance?: number } = {}): PosDisplayStandbyFlowScene {
  const density = Math.max(50, Math.min(180, settings.density ?? 100));
  const variance = Math.max(0, Math.min(40, settings.speedVariance ?? 0)) / 100;
  if (variance > 0 && geometry.corridors) {
    const resolved = geometry.corridors.map(corridor => withDensity(corridor.dense, corridor.baselineWidth, density));
    return { mode: 'layered', fallbackReason: null, density, densityLimited: resolved.some(layer => layer.limited),
      layers: resolved.map(({ layout }, index) => ({ ...layout, id: index, speedMultiplier: 1 + geometry.corridors![index].depth * variance })) };
  }
  const resolved = withDensity(geometry.dense, geometry.baseline.tileWidth, density);
  return { mode: 'uniform', fallbackReason: variance > 0 ? geometry.fallbackReason : null, density, densityLimited: resolved.limited,
    layers: [{ ...resolved.layout, id: 0, speedMultiplier: 1 }] };
}

/** Convenient pure entry point for callers that do not retain prepared metrics. */
export function createPosDisplayStandbyFlowScene(input: FlowInput & { density?: number; speedVariance?: number }): PosDisplayStandbyFlowScene {
  return resolvePosDisplayStandbyFlowScene(preparePosDisplayStandbyFlowGeometry(input), input);
}
