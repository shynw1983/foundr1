"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getPosDisplayStandbyWordFontSize, type PosDisplayStandbyBlock } from "../../lib/pos-display-standby";
import { preparePosDisplayStandbyFlowGeometry, resolvePosDisplayStandbyFlowScene, posDisplayStandbyFlowSeed as seededValue, type PosDisplayStandbyFlowMetric } from "../../lib/pos-display-standby-flow";
import styles from "./PosDisplayStandbyAmbient.module.css";

type Props = { block: PosDisplayStandbyBlock; paused?: boolean };
type MeasuredFlow = { key: string; screenWidth: number; height: number; words: PosDisplayStandbyFlowMetric[] };
function contentLines(text: string | undefined) {
  return (text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12);
}
function characterWidth(text: string) {
  return Array.from(text).reduce((sum, char) => sum + (/^[\u0000-\u007f]$/.test(char) ? .65 : 1), 0);
}
function useAmbientAvailability() {
  const [availability, setAvailability] = useState({ hidden: false, reduced: false });
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAvailability({ hidden: document.hidden, reduced: query.matches });
    update();
    document.addEventListener("visibilitychange", update);
    query.addEventListener("change", update);
    return () => { document.removeEventListener("visibilitychange", update); query.removeEventListener("change", update); };
  }, []);
  return availability;
}

export function PosDisplayStandbyAmbient({ block, paused = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const measurements = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => contentLines(block.text), [block.text]);
  const isWordCloud = block.type === "wordCloud";
  const sizes = lines.map((_, index) => getPosDisplayStandbyWordFontSize(block, index));
  const seed = `${block.id}:${block.text}`;
  const measurementKey = JSON.stringify([seed, block.fontFamily, block.fontSize, sizes]);
  const [measured, setMeasured] = useState<MeasuredFlow | null>(null);
  useEffect(() => {
    if (!isWordCloud || !root.current || !measurements.current || !lines.length) return;
    const element = root.current, measureElement = measurements.current;
    let cancelled = false, frame = 0;
    const measure = () => {
      frame = 0;
      if (cancelled) return;
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      const words = Array.from(measureElement.children).map((word, index) => {
        const rectangle = word.getBoundingClientRect();
        return { index, width: rectangle.width, height: rectangle.height };
      });
      if (words.length !== lines.length || words.some(word => !word.width || !word.height)) return;
      const next = { key: measurementKey, screenWidth: width, height, words };
      setMeasured(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { if (!frame && !cancelled) frame = window.requestAnimationFrame(measure); };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    document.fonts?.ready.then(schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    return () => { cancelled = true; window.cancelAnimationFrame(frame); observer.disconnect(); document.fonts?.removeEventListener("loadingdone", schedule); };
  }, [isWordCloud, lines.length, measurementKey, seed]);

  const geometry = useMemo(() => measured ? preparePosDisplayStandbyFlowGeometry({ width: measured.screenWidth, height: measured.height, words: measured.words, seed }) : null, [measured, seed]);
  const flow = useMemo(() => geometry ? resolvePosDisplayStandbyFlowScene(geometry, { density: block.wordDensity, speedVariance: block.wordSpeedVariance }) : null,
    [geometry, block.wordDensity, block.wordSpeedVariance]);
  const flowReady = measured?.key === measurementKey;
  const motion = block.motion ?? "gentle";
  const availability = useAmbientAvailability();
  // Visibility preserves the shared plane's phase. Editor/still/reduced-motion
  // show all phrases in a fitted overview instead of freezing them offscreen.
  const overview = paused || motion === "still" || availability.reduced || (isWordCloud && !flowReady);
  const stopped = overview || availability.hidden;
  const seconds = Math.max(8, Math.min(90, block.animationSeconds ?? (isWordCloud ? 24 : 8)));
  const [activeMessage, setActiveMessage] = useState(0);
  useEffect(() => { setActiveMessage(0); }, [block.text]);
  useEffect(() => {
    if (isWordCloud || stopped || lines.length < 2) return;
    const timer = window.setInterval(() => setActiveMessage(index => (index + 1) % lines.length), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [isWordCloud, lines.length, seconds, stopped]);

  const columns = lines.length <= 2 ? 1 : lines.length <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(lines.length / columns));
  const order = useMemo(() => Array.from({ length: columns * rows }, (_, index) => index)
    .sort((a, b) => seededValue(seed, a) - seededValue(seed, b)), [columns, rows, seed]);
  const message = lines[activeMessage % Math.max(1, lines.length)] ?? "";
  const firstLayer = flow?.layers[0];
  const cycleSeconds = firstLayer && measured ? firstLayer.tileWidth / measured.screenWidth * seconds / firstLayer.speedMultiplier : seconds;
  function word(line: string, index: number, copy?: number, layer?: number) {
    return <span className={styles.word} data-standby-word={line} data-standby-phrase-index={index} data-standby-copy={copy}
      data-standby-flow-layer={layer}
      data-standby-requested-font-size={sizes[index]} data-standby-word-font-size={overview ? undefined : sizes[index]} data-standby-font-mode={overview ? "fit-overview" : "exact"}>{line}</span>;
  }
  return <div ref={root} className={styles.ambient} data-standby-ambient={block.type} data-standby-motion={motion} data-standby-paused={stopped}
    data-standby-word-overview={isWordCloud ? overview : undefined} role="img" aria-label={lines.join("、")}>
    {isWordCloud ? <div className={styles.wordCloud} aria-hidden="true" data-standby-flow-ready={flowReady} data-standby-flow-tile-width={firstLayer?.tileWidth}
      data-standby-flow-screen-width={measured?.screenWidth} data-standby-flow-cycle-seconds={cycleSeconds}
      data-standby-flow-mode={flow?.mode} data-standby-flow-fallback={flow?.fallbackReason ?? undefined}
      data-standby-flow-density={flow?.density ?? block.wordDensity ?? 100} data-standby-flow-density-limited={flow?.densityLimited ?? false}
      style={{ "--cloud-columns": columns, "--cloud-rows": rows } as CSSProperties}>
      <div ref={measurements} className={styles.measurements}>
        {lines.map((line, index) => <span key={`${index}:${line}`} data-standby-measure-word={index} className={styles.measureWord} style={{ fontSize: `${sizes[index] / block.fontSize}em` }}>{line}</span>)}
      </div>
      {overview ? lines.map((line, index) => <span key={`${index}:${line}`} className={styles.wordSlot} data-standby-word-slot={order[index]} style={{
        gridColumn: order[index] % columns + 1, gridRow: Math.floor(order[index] / columns) + 1,
        "--word-font-ratio": sizes[index] / block.fontSize,
        "--word-width-cap": `max(1px, calc((${100 / columns - 4}cqw) / ${Math.max(1, characterWidth(line))}))`, "--word-height-cap": `${75 / rows}cqh`,
      } as CSSProperties}><span className={styles.overviewTrack}>{word(line, index)}</span></span>) : flow && measured ? flow.layers.map(layer => {
        const layerCycleSeconds = layer.tileWidth / measured.screenWidth * seconds / layer.speedMultiplier;
        // Dense geometry is never narrower than 1/1.8 screen widths: four
        // copies per phrase cover the viewport and both seamless loop edges.
        const copies = Array.from({ length: Math.ceil(measured.screenWidth / layer.tileWidth) + 2 }, (_, index) => index - 1);
        return <div key={layer.id} className={styles.flowPlane} data-standby-flow-plane data-standby-flow-layer={layer.id}
          data-standby-flow-tile-width={layer.tileWidth} data-standby-flow-screen-width={measured.screenWidth}
          data-standby-screen-seconds={seconds} data-standby-cycle-seconds={layerCycleSeconds} data-standby-speed-multiplier={layer.speedMultiplier}
          data-standby-flow-density={flow.density} style={{
            "--flow-tile-width": `${layer.tileWidth}px`, "--flow-cycle-seconds": `${layerCycleSeconds}s`,
            "--flow-delay": `${-layerCycleSeconds * seededValue(seed, 901 + layer.id * 47)}s`,
          } as CSSProperties}>
          {copies.flatMap(copy => layer.words.map(placement => <span key={`${copy}:${placement.index}`} className={styles.wordTrack}
            data-standby-word-track data-standby-phrase-index={placement.index} data-standby-copy={copy} data-standby-flow-layer={layer.id}
            style={{ left: placement.x + copy * layer.tileWidth, top: placement.y, fontSize: `${sizes[placement.index] / block.fontSize}em` }}>
            {word(lines[placement.index], placement.index, copy, layer.id)}
          </span>))}
        </div>;
      }) : null}
    </div> : <div className={styles.messages} aria-hidden="true"><span key={`${activeMessage}:${message}`} className={styles.message} data-standby-message={message}>{message}</span></div>}
  </div>;
}
