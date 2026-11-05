/** Masked gradient-domain cloning. Original RGB is sampled ONLY at alpha=0 outside neighbours. */
export const ERASE_POISSON_SMALL_PIXELS = 150_000;
export const ERASE_POISSON_GRID_EDGE = 192;
export const ERASE_POISSON_BAND = 24;
export const ERASE_POISSON_MAX_BAND_PIXELS = 300_000;
export const ERASE_POISSON_MAX_COMPONENTS = 64;
export const ERASE_POISSON_MAX_NODE_UPDATES = 60_000_000;
const MAX_ITERATIONS = 1200;
type Box = { left: number; top: number; width: number; height: number };
type Component = { pixels: Uint32Array; box: Box; band: Uint32Array | null };
export type ErasePoissonPlan = { width: number; height: number; selected: number; components: Component[]; bandPixels: number; minimumNodeUpdates: number };
export type ErasePoissonStats = { selected: number; components: number; small: number; large: number; bandPixels: number; nodeUpdates: number; iterations: number; maximumResidual: number; clampedChannels: number };
const fail = () => { throw new Error('ai_failed'); };

/** Geometry-only preflight runs before the paid provider call. */
export function prepareErasePoisson(alpha: Uint8Array, width: number, height: number): ErasePoissonPlan {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 8_294_400 || alpha.length !== width * height) throw new Error('ai_invalid_mask');
  let selected = 0; for (const value of alpha) if (value) selected++;
  if (!selected || selected > alpha.length * .9) throw new Error('ai_invalid_mask');
  const labels = new Uint16Array(alpha.length), queue = new Uint32Array(selected), components: Component[] = [];
  let tail = 0, head = 0, id = 0;
  const enqueue = (n: number) => { if (alpha[n] && !labels[n]) { labels[n] = id; queue[tail++] = n; } };
  for (let seed = 0; seed < alpha.length; seed++) {
    if (!alpha[seed] || labels[seed]) continue;
    if (++id > ERASE_POISSON_MAX_COMPONENTS) throw new Error('ai_invalid_mask');
    const start = tail; head = start; enqueue(seed); let left = width, top = height, right = 0, bottom = 0, boundaries = 0;
    while (head < tail) {
      const n = queue[head++], x = n % width, y = Math.floor(n / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (x > 0) { if (!alpha[n - 1]) boundaries++; enqueue(n - 1); }
      if (x + 1 < width) { if (!alpha[n + 1]) boundaries++; enqueue(n + 1); }
      if (y > 0) { if (!alpha[n - width]) boundaries++; enqueue(n - width); }
      if (y + 1 < height) { if (!alpha[n + width]) boundaries++; enqueue(n + width); }
    }
    if (!boundaries) throw new Error('ai_invalid_mask');
    components.push({ pixels: queue.subarray(start, tail), box: { left, top, width: right - left + 1, height: bottom - top + 1 }, band: null });
  }
  const distance = components.some(c => c.pixels.length > ERASE_POISSON_SMALL_PIXELS) ? new Uint8Array(alpha.length) : null;
  const bandQueue = distance ? new Uint32Array(ERASE_POISSON_MAX_BAND_PIXELS) : null;
  let bandPixels = 0, minimumNodeUpdates = 0;
  for (let componentId = 0; componentId < components.length; componentId++) {
    const component = components[componentId];
    if (component.pixels.length <= ERASE_POISSON_SMALL_PIXELS) {
      minimumNodeUpdates += component.pixels.length * 16;
      if (component.pixels.length > 20_000 || Math.max(component.box.width, component.box.height) > ERASE_POISSON_GRID_EDGE) { const scale = Math.min(1, ERASE_POISSON_GRID_EDGE / Math.max(component.box.width, component.box.height)); minimumNodeUpdates += Math.ceil(component.box.width * scale) * Math.ceil(component.box.height * scale) * 16; }
      continue;
    }
    const start = bandPixels; head = start;
    const add = (n: number, depth: number) => { if (labels[n] === componentId + 1 && !distance![n]) { if (bandPixels >= ERASE_POISSON_MAX_BAND_PIXELS) throw new Error('ai_invalid_mask'); distance![n] = depth; bandQueue![bandPixels++] = n; } };
    for (const n of component.pixels) {
      const x = n % width, y = Math.floor(n / width);
      if (x > 0 && !alpha[n - 1] || x + 1 < width && !alpha[n + 1] || y > 0 && !alpha[n - width] || y + 1 < height && !alpha[n + width]) add(n, 1);
    }
    while (head < bandPixels) {
      const n = bandQueue![head++], depth = distance![n], x = n % width, y = Math.floor(n / width); if (depth >= ERASE_POISSON_BAND) continue;
      if (x > 0) add(n - 1, depth + 1); if (x + 1 < width) add(n + 1, depth + 1); if (y > 0) add(n - width, depth + 1); if (y + 1 < height) add(n + width, depth + 1);
    }
    component.band = bandQueue!.subarray(start, bandPixels);
    const scale = Math.min(1, ERASE_POISSON_GRID_EDGE / Math.max(component.box.width, component.box.height));
    minimumNodeUpdates += (component.band.length + Math.ceil(component.box.width * scale) * Math.ceil(component.box.height * scale)) * 16;
  }
  if (minimumNodeUpdates > ERASE_POISSON_MAX_NODE_UPDATES) throw new Error('ai_invalid_mask');
  return { width, height, selected, components, bandPixels, minimumNodeUpdates };
}

type Graph = { pixels: Uint32Array; adjacent: Int32Array; rhs: Float64Array; degree: Uint8Array; parity: Uint8Array };
type Budget = { used: number; iterations: number; residual: number };
function solve(graph: Graph, initial: [number, number, number], budget: Budget, initialAt?: (pixel: number, channel: number) => number): Float64Array {
  const count = graph.pixels.length, field = new Float64Array(count * 3); if (!count) return field;
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) field[i * 3 + c] = initialAt ? initialAt(graph.pixels[i], c) : initial[c];
  const residual = () => {
    let maximum = 0;
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) {
      let sum = graph.rhs[i * 3 + c]; for (let k = 0; k < graph.degree[i]; k++) { const q = graph.adjacent[i * 4 + k]; if (q >= 0) sum += field[q * 3 + c]; }
      maximum = Math.max(maximum, Math.abs(field[i * 3 + c] - sum / graph.degree[i]));
    }
    return maximum;
  };
  let converged = false, finalResidual = Infinity;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (budget.used + count > ERASE_POISSON_MAX_NODE_UPDATES) fail();
    let change = 0;
    for (let parity = 0; parity < 2; parity++) for (let i = 0; i < count; i++) {
      if (graph.parity[i] !== parity) continue;
      for (let c = 0; c < 3; c++) {
        let sum = graph.rhs[i * 3 + c]; for (let k = 0; k < graph.degree[i]; k++) { const q = graph.adjacent[i * 4 + k]; if (q >= 0) sum += field[q * 3 + c]; }
        const old = field[i * 3 + c], next = old + 1.85 * (sum / graph.degree[i] - old); if (!Number.isFinite(next)) fail();
        field[i * 3 + c] = next; change = Math.max(change, Math.abs(next - old));
      }
    }
    budget.used += count; budget.iterations++;
    if (change < .002) { finalResidual = residual(); if (finalResidual < .01) { converged = true; break; } }
  }
  if (!converged) fail(); budget.residual = Math.max(budget.residual, finalResidual); return field;
}

/** Returns a coarse correction field derived ONLY from actual alpha=0 source/model neighbours. */
function coarseField(component: Component, source: Uint8Array, model: Uint8Array, alpha: Uint8Array, width: number, height: number, boundary: (n: number, c: number) => number, budget: Budget) {
  const { box } = component, scale = Math.min(1, ERASE_POISSON_GRID_EDGE / Math.max(box.width, box.height)), gw = Math.max(1, Math.ceil(box.width * scale)), gh = Math.max(1, Math.ceil(box.height * scale)), cells = gw * gh;
  const active = new Uint8Array(cells), observations = new Uint32Array(cells), values = new Float64Array(cells * 3), ids = new Int32Array(cells).fill(-1);
  const cell = (n: number) => Math.min(gh - 1, Math.floor((Math.floor(n / width) - box.top) / box.height * gh)) * gw + Math.min(gw - 1, Math.floor((n % width - box.left) / box.width * gw));
  for (const n of component.pixels) {
    const g = cell(n), x = n % width, y = Math.floor(n / width); active[g] = 1;
    const visit = (q: number) => { if (!alpha[q]) { observations[g]++; for (let c = 0; c < 3; c++) values[g * 3 + c] += boundary(q, c); } };
    if (x > 0) visit(n - 1); if (x + 1 < width) visit(n + 1); if (y > 0) visit(n - width); if (y + 1 < height) visit(n + width);
  }
  let count = 0, anchors = 0; const initial: [number, number, number] = [0, 0, 0];
  for (let n = 0; n < cells; n++) if (active[n]) {
    if (observations[n]) { anchors++; for (let c = 0; c < 3; c++) { values[n * 3 + c] /= observations[n]; initial[c] += values[n * 3 + c]; } }
    else ids[n] = count++;
  }
  if (!anchors) fail(); for (let c = 0; c < 3; c++) initial[c] /= anchors;
  const graph: Graph = { pixels: new Uint32Array(count), adjacent: new Int32Array(count * 4).fill(-1), rhs: new Float64Array(count * 3), degree: new Uint8Array(count), parity: new Uint8Array(count) };
  for (let n = 0; n < cells; n++) if (ids[n] >= 0) {
    const id = ids[n], x = n % gw, y = Math.floor(n / gw); graph.pixels[id] = n; graph.parity[id] = (x + y) & 1;
    const visit = (q: number) => { if (!active[q]) return; const k = graph.degree[id]++; graph.adjacent[id * 4 + k] = ids[q]; if (observations[q]) for (let c = 0; c < 3; c++) graph.rhs[id * 3 + c] += values[q * 3 + c]; };
    if (x > 0) visit(n - 1); if (x + 1 < gw) visit(n + 1); if (y > 0) visit(n - gw); if (y + 1 < gh) visit(n + gw);
    if (!graph.degree[id]) fail();
  }
  const solved = solve(graph, initial, budget);
  for (let n = 0; n < cells; n++) if (ids[n] >= 0) for (let c = 0; c < 3; c++) values[n * 3 + c] = solved[ids[n] * 3 + c];
  const sample = (n: number, c: number) => {
    const fx = Math.max(0, Math.min(gw - 1, (n % width - box.left + .5) / box.width * gw - .5)), fy = Math.max(0, Math.min(gh - 1, (Math.floor(n / width) - box.top + .5) / box.height * gh - .5)), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const p = [y0 * gw + x0, y0 * gw + x1, y1 * gw + x0, y1 * gw + x1], weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty]; let sum = 0, weight = 0;
    for (let j = 0; j < 4; j++) if (active[p[j]]) { sum += values[p[j] * 3 + c] * weights[j]; weight += weights[j]; }
    return weight ? sum / weight : initial[c];
  };
  return { sample, initial };
}

/** Mutates only model RGB in Ω. Source RGB inside Ω never participates in the PDE. */
export function applyErasePoisson(source: Uint8Array, model: Uint8Array, alpha: Uint8Array, plan: ErasePoissonPlan): ErasePoissonStats {
  const { width, height } = plan;
  if (source.length !== width * height * 4 || model.length !== source.length || alpha.length !== width * height) fail();
  const indices = new Int32Array(alpha.length).fill(-1), budget: Budget = { used: 0, iterations: 0, residual: 0 };
  const stats: ErasePoissonStats = { selected: plan.selected, components: plan.components.length, small: 0, large: 0, bandPixels: plan.bandPixels, nodeUpdates: 0, iterations: 0, maximumResidual: 0, clampedChannels: 0 };
  const boundary = (n: number, c: number) => {
    if (alpha[n]) fail();
    // The provider input is flattened over white. Hidden transparent RGB is not
    // an observed scene colour and must never become a lighting anchor.
    const a = source[n * 4 + 3] / 255, b = model[n * 4 + 3] / 255;
    return source[n * 4 + c] * a + 255 * (1 - a) - (model[n * 4 + c] * b + 255 * (1 - b));
  };
  for (const component of plan.components) {
    const useWarmStart = component.band || component.pixels.length > 20_000 || Math.max(component.box.width, component.box.height) > ERASE_POISSON_GRID_EDGE;
    const coarse = useWarmStart ? coarseField(component, source, model, alpha, width, height, boundary, budget) : null, domain = component.band ?? component.pixels;
    if (component.band) stats.large++; else stats.small++;
    for (let i = 0; i < domain.length; i++) indices[domain[i]] = i;
    const graph: Graph = { pixels: domain, adjacent: new Int32Array(domain.length * 4).fill(-1), rhs: new Float64Array(domain.length * 3), degree: new Uint8Array(domain.length), parity: new Uint8Array(domain.length) };
    const initial: [number, number, number] = coarse ? [...coarse.initial] : [0, 0, 0]; let anchors = 0;
    for (let id = 0; id < domain.length; id++) {
      const n = domain[id], x = n % width, y = Math.floor(n / width); graph.parity[id] = (x + y) & 1;
      const visit = (q: number) => {
        const k = graph.degree[id]++, other = indices[q]; graph.adjacent[id * 4 + k] = other;
        if (other >= 0) return;
        for (let c = 0; c < 3; c++) { const value = !alpha[q] ? boundary(q, c) : coarse ? coarse.sample(q, c) : fail(); graph.rhs[id * 3 + c] += value; if (!coarse) initial[c] += value; }
        anchors++;
      };
      if (x > 0) visit(n - 1); if (x + 1 < width) visit(n + 1); if (y > 0) visit(n - width); if (y + 1 < height) visit(n + width);
      if (!graph.degree[id]) fail();
    }
    if (!anchors) fail(); if (!coarse) for (let c = 0; c < 3; c++) initial[c] /= anchors;
    const solved = solve(graph, initial, budget, coarse?.sample);
    for (const n of component.pixels) for (let c = 0; c < 3; c++) {
      const id = indices[n], correction = id >= 0 ? solved[id * 3 + c] : coarse ? coarse.sample(n, c) : fail(), value = model[n * 4 + c] + correction;
      if (!Number.isFinite(value)) fail(); if (value < 0 || value > 255) stats.clampedChannels++;
      model[n * 4 + c] = Math.round(Math.max(0, Math.min(255, value)));
    }
    for (const n of domain) indices[n] = -1;
  }
  stats.nodeUpdates = budget.used; stats.iterations = budget.iterations; stats.maximumResidual = budget.residual; return stats;
}
