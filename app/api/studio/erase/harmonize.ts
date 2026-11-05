/** Bounded gradient-domain tone matching. Only model RGB inside a selected component changes. */
export const ERASE_TONE_GRID_EDGE = 128;
export const ERASE_TONE_MAX_ITERATIONS = 600;
export const ERASE_TONE_MAX_GRID_VISITS = 24_000_000;
export const ERASE_TONE_MAX_COMPONENTS = 64;
export const ERASE_TONE_MAX_OFFSET = 128;
const SAMPLES_PER_CELL = 16;
export type EraseToneStats = { components: number; corrected: number; transparent: number; border: number; tiny: number; noAnchors: number; budget: number; unconverged: number; gridVisits: number; maximumIterations: number; maximumOffset: number };

/**
 * Match the model's low-frequency tone to the untouched boundary using a coarse
 * harmonic RGB correction field. This preserves model texture rather than copying
 * original object pixels or blurring the generated photograph. Source pixels and
 * alpha are never changed. Disconnected components cannot share a correction field.
 *
 * A selection that cuts through the target itself can still produce a halo. The
 * user must include its complete outline/shadow and a small background margin.
 */
export function harmonizeEraseTone(source: Uint8Array, model: Uint8Array, alpha: Uint8Array, width: number, height: number): EraseToneStats {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 8_294_400 || alpha.length !== width * height || source.length !== alpha.length * 4 || model.length !== source.length) throw new Error('ai_invalid_input');
  const stats: EraseToneStats = { components: 0, corrected: 0, transparent: 0, border: 0, tiny: 0, noAnchors: 0, budget: 0, unconverged: 0, gridVisits: 0, maximumIterations: 0, maximumOffset: 0 };
  let selected = 0; for (const value of alpha) if (value) selected++;
  if (!selected) return stats;
  const visited = new Uint8Array(alpha.length), queue = new Uint32Array(selected);
  let first = 0, last = 0, attempted = 0;
  const enqueue = (n: number) => { if (alpha[n] && !visited[n]) { visited[n] = 1; queue[last++] = n; } };
  const median = (values: number[]) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; };
  for (let seed = 0; seed < alpha.length; seed++) {
    if (!alpha[seed] || visited[seed]) continue;
    stats.components++; first = 0; last = 0; enqueue(seed);
    let left = width, top = height, right = 0, bottom = 0, opaque = true, touchesBorder = false;
    while (first < last) {
      const n = queue[first++], x = n % width, y = Math.floor(n / width), i = n * 4;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (source[i + 3] !== 255 || model[i + 3] !== 255) opaque = false;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      if (x > 0) enqueue(n - 1); if (x + 1 < width) enqueue(n + 1); if (y > 0) enqueue(n - width); if (y + 1 < height) enqueue(n + width);
    }
    if (!opaque) { stats.transparent++; continue; }
    if (touchesBorder) { stats.border++; continue; }
    const bw = right - left + 1, bh = bottom - top + 1;
    if (last < 32 || Math.min(bw, bh) < 3) { stats.tiny++; continue; }
    if (attempted >= ERASE_TONE_MAX_COMPONENTS || stats.gridVisits >= ERASE_TONE_MAX_GRID_VISITS) { stats.budget++; continue; }
    attempted++;
    const scale = Math.min(1, ERASE_TONE_GRID_EDGE / Math.max(bw, bh)), gw = Math.max(1, Math.ceil(bw * scale)), gh = Math.max(1, Math.ceil(bh * scale)), cells = gw * gh;
    const active = new Uint8Array(cells), known = new Uint8Array(cells), counts = new Uint32Array(cells), samples = new Float32Array(cells * 3 * SAMPLES_PER_CELL), field = new Float32Array(cells * 3);
    const cell = (n: number) => Math.min(gh - 1, Math.floor((Math.floor(n / width) - top) / bh * gh)) * gw + Math.min(gw - 1, Math.floor((n % width - left) / bw * gw));
    let anchors = 0;
    for (let k = 0; k < last; k++) {
      const n = queue[k], x = n % width, y = Math.floor(n / width), i = n * 4, g = cell(n); active[g] = 1;
      const boundary = (x > 0 && !alpha[n - 1] && source[(n - 1) * 4 + 3] === 255) || (x + 1 < width && !alpha[n + 1] && source[(n + 1) * 4 + 3] === 255)
        || (y > 0 && !alpha[n - width] && source[(n - width) * 4 + 3] === 255) || (y + 1 < height && !alpha[n + width] && source[(n + width) * 4 + 3] === 255);
      if (!boundary) continue;
      const dr = source[i] - model[i], dg = source[i + 1] - model[i + 1], db = source[i + 2] - model[i + 2];
      // Extremely different boundary colours are not reliable background anchors.
      if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) > ERASE_TONE_MAX_OFFSET) continue;
      const count = ++counts[g]; anchors++;
      // Deterministic bounded reservoir avoids memory growth on checkerboard masks.
      const slot = count <= SAMPLES_PER_CELL ? count - 1 : (Math.imul(count, 0x9e3779b1) >>> 0) % count;
      if (slot < SAMPLES_PER_CELL) { samples[(g * 3) * SAMPLES_PER_CELL + slot] = dr; samples[(g * 3 + 1) * SAMPLES_PER_CELL + slot] = dg; samples[(g * 3 + 2) * SAMPLES_PER_CELL + slot] = db; }
    }
    const globals: [number[], number[], number[]] = [[], [], []]; let anchorCells = 0, unknown = 0;
    for (let n = 0; n < cells; n++) {
      if (!active[n]) continue;
      if (!counts[n]) { unknown++; continue; }
      known[n] = 1; anchorCells++;
      for (let c = 0; c < 3; c++) { const start = (n * 3 + c) * SAMPLES_PER_CELL, values = samples.subarray(start, start + Math.min(counts[n], SAMPLES_PER_CELL)); values.sort(); const value = values[Math.floor(values.length / 2)]; field[n * 3 + c] = value; globals[c].push(value); }
    }
    if (anchors < 8 || anchorCells < 3) { stats.noAnchors++; continue; }
    const defaults = globals.map(values => median(values));
    for (let n = 0; n < cells; n++) if (active[n] && !known[n]) for (let c = 0; c < 3; c++) field[n * 3 + c] = defaults[c];
    let converged = unknown === 0, iterations = 0;
    const allowedIterations = Math.min(ERASE_TONE_MAX_ITERATIONS, Math.floor((ERASE_TONE_MAX_GRID_VISITS - stats.gridVisits) / (cells * 2)));
    for (; !converged && iterations < allowedIterations; iterations++) {
      let change = 0;
      for (let parity = 0; parity < 2; parity++) for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const n = y * gw + x; if (!active[n] || known[n] || (x + y) % 2 !== parity) continue;
        const leftCell = x > 0 && active[n - 1], rightCell = x + 1 < gw && active[n + 1], topCell = y > 0 && active[n - gw], bottomCell = y + 1 < gh && active[n + gw];
        const count = Number(leftCell) + Number(rightCell) + Number(topCell) + Number(bottomCell); if (!count) continue;
        for (let c = 0; c < 3; c++) {
          const before = field[n * 3 + c], sum = (leftCell ? field[(n - 1) * 3 + c] : 0) + (rightCell ? field[(n + 1) * 3 + c] : 0) + (topCell ? field[(n - gw) * 3 + c] : 0) + (bottomCell ? field[(n + gw) * 3 + c] : 0);
          const next = Math.max(-ERASE_TONE_MAX_OFFSET, Math.min(ERASE_TONE_MAX_OFFSET, before + 1.7 * (sum / count - before)));
          field[n * 3 + c] = next; change = Math.max(change, Math.abs(next - before));
        }
      }
      stats.gridVisits += cells * 2; converged = change < .003;
    }
    stats.maximumIterations = Math.max(stats.maximumIterations, iterations);
    if (!converged) { if (allowedIterations < ERASE_TONE_MAX_ITERATIONS) stats.budget++; else stats.unconverged++; continue; }
    for (let k = 0; k < last; k++) {
      const n = queue[k], x = n % width, y = Math.floor(n / width), fx = Math.max(0, Math.min(gw - 1, (x - left + .5) / bw * gw - .5)), fy = Math.max(0, Math.min(gh - 1, (y - top + .5) / bh * gh - .5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const positions = [y0 * gw + x0, y0 * gw + x1, y1 * gw + x0, y1 * gw + x1], weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      // Ignore inactive cells instead of introducing a zero offset beside holes.
      let weight = 0; for (let j = 0; j < 4; j++) if (active[positions[j]]) weight += weights[j];
      for (let c = 0; c < 3; c++) {
        let offset = defaults[c];
        if (weight > 0) { offset = 0; for (let j = 0; j < 4; j++) if (active[positions[j]]) offset += field[positions[j] * 3 + c] * weights[j] / weight; }
        offset = Math.max(-ERASE_TONE_MAX_OFFSET, Math.min(ERASE_TONE_MAX_OFFSET, offset)); stats.maximumOffset = Math.max(stats.maximumOffset, Math.abs(offset));
        model[n * 4 + c] = Math.max(0, Math.min(255, Math.round(model[n * 4 + c] + offset)));
      }
    }
    stats.corrected++;
  }
  return stats;
}
