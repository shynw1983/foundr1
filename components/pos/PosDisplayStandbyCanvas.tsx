"use client";

import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { getPosDisplayStandbyFontFamily, isSafePosDisplayStandbyImageUrl, type PosDisplayStandbyBlock, type PosDisplayStandbySettings } from "../../lib/pos-display-standby";
import { snapStandbyPosition, standbyCenteredAxes } from "../../lib/pos-display-standby-geometry";
import { useOsTranslation } from "../../app/os/components/OsTranslationProvider";
import { PosDisplayStandbyAmbient } from "./PosDisplayStandbyAmbient";
import { PosDisplayStandbyWeather } from "./PosDisplayStandbyWeather";
import { usePosDisplayWeather } from "./usePosDisplayWeather";
import styles from "./PosDisplayStandbyCanvas.module.css";

type Orientation = "portrait" | "landscape";
type Props = {
  settings: PosDisplayStandbySettings;
  orientation: Orientation;
  storeName: string;
  storeId?: string;
  date?: Date;
  editing?: boolean;
  animateSelected?: boolean;
  snapToGrid?: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
};

/** The editor and the display render the same percentage-based layout. */
export function PosDisplayStandbyCanvas({ settings, orientation, storeName, storeId, date = new Date(), editing = false, animateSelected = false, snapToGrid = true, selectedId, onSelect, onMove }: Props) {
  const { t } = useOsTranslation();
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointer: number; clientX: number; clientY: number; x: number; y: number; width: number; height: number; horizontal: boolean } | null>(null);
  useEffect(() => { drag.current = null; }, [orientation, editing]);
  const visibleBlocks = settings.layouts[orientation].filter(block => block.hidden !== true);
  const selected = visibleBlocks.find(block => block.id === selectedId);
  const centered = selected ? standbyCenteredAxes(selected.type === "wordCloud" && selected.motion !== "still" ? { ...selected, x: 0, width: 100 } : selected) : null;
  const time = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const day = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" }).format(date);
  const weather = usePosDisplayWeather(storeId, visibleBlocks.some(block => block.type === "weather"));
  function pointerDown(event: PointerEvent<HTMLButtonElement>, block: PosDisplayStandbyBlock) {
    if (event.button !== 0) return;
    event.preventDefault(); onSelect?.(block.id);
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: block.id, pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: block.x, y: block.y, width: block.width, height: block.height, horizontal: block.type !== "wordCloud" || block.motion === "still" };
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current, rect = canvas.current?.getBoundingClientRect();
    if (!current || current.pointer !== event.pointerId || !rect?.width || !rect.height) return;
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    // A click or movement on the other axis must not snap an untouched coordinate.
    if ((!current.horizontal || Math.abs(dx) < 3) && Math.abs(dy) < 3) return;
    const threshold = (length: number) => Math.min(2, Math.max(0.5, 6 / length * 100));
    const x = !current.horizontal || Math.abs(dx) < 3 ? current.x : snapStandbyPosition(current.x + dx / rect.width * 100, current.width, snapToGrid, threshold(rect.width));
    const y = Math.abs(dy) < 3 ? current.y : snapStandbyPosition(current.y + dy / rect.height * 100, current.height, snapToGrid, threshold(rect.height));
    onMove?.(current.id, x, y);
  }
  function content(block: PosDisplayStandbyBlock) {
    if (block.type === "image") return block.imageUrl && isSafePosDisplayStandbyImageUrl(block.imageUrl)
      ? <img src={block.imageUrl} alt="" draggable={false} />
      : editing ? <span className={styles.placeholder}>{t("ロゴ・画像")}</span> : null;
    if (block.type === "clock") return <div className={styles.clock}><span style={{ fontFamily: getPosDisplayStandbyFontFamily(block.fontFamily), fontWeight: block.fontFamily === "georgia" ? 400 : undefined }}>{time}</span>{block.showDate ? <small>{day}</small> : null}</div>;
    if (block.type === "date") return <time className={styles.date} data-standby-date dateTime={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)}>
      {new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", ...(block.showYear === false ? {} : { year: "numeric" as const }), month: "long", day: "numeric", weekday: "short" }).format(date)}
    </time>;
    if (block.type === "wordCloud" || block.type === "messages") return <PosDisplayStandbyAmbient block={block} paused={editing && selectedId === block.id && !animateSelected} />;
    if (block.type === "weather") return <PosDisplayStandbyWeather block={block} weather={weather} editing={editing} />;
    return <span className={styles.text} style={{ fontFamily: getPosDisplayStandbyFontFamily(block.fontFamily) }}>{block.type === "storeName" ? storeName : block.text}</span>;
  }
  return <div ref={canvas} className={`${styles.canvas} ${editing ? styles.editing : ""}`} style={{ backgroundColor: settings.backgroundColor }} data-i18n-ignore data-standby-canvas data-standby-layout={orientation}>
    {editing && centered ? <>
      <span aria-hidden="true" data-standby-guide="horizontal-center" data-centered={centered.horizontal} className={`${styles.guide} ${styles.verticalGuide} ${centered.horizontal ? styles.alignedGuide : ""}`} />
      <span aria-hidden="true" data-standby-guide="vertical-center" data-centered={centered.vertical} className={`${styles.guide} ${styles.horizontalGuide} ${centered.vertical ? styles.alignedGuide : ""}`} />
    </> : null}
    {visibleBlocks.map(block => {
      const fullWidth = block.type === "wordCloud" && block.motion !== "still";
      const style: CSSProperties = { left: `${fullWidth ? 0 : block.x}%`, top: `${block.y}%`, width: `${fullWidth ? 100 : block.width}%`, height: `${block.height}%`, color: block.color,
        fontSize: `${block.fontSize}cqmin`, fontFamily: block.type === "clock" ? "inherit" : getPosDisplayStandbyFontFamily(block.fontFamily), textAlign: block.align, justifyContent: block.align === "left" ? "flex-start" : block.align === "right" ? "flex-end" : "center" };
      if (!editing) return <div key={block.id} className={styles.block} style={style} data-standby-block={block.id} data-standby-type={block.type} data-standby-font={block.fontFamily ?? "standard"}>{content(block)}</div>;
      return <button key={block.id} type="button" className={`${styles.block} ${styles.editable} ${selectedId === block.id ? styles.selected : ""}`}
        style={style} data-standby-block={block.id} data-standby-type={block.type} data-standby-font={block.fontFamily ?? "standard"} aria-pressed={selectedId === block.id}
        aria-label={block.type === "text" ? block.text || t("文字") : t(block.type === "clock" ? "時計" : block.type === "image" ? "ロゴ・画像" : block.type === "date" ? "日付" : block.type === "weather" ? "天気" : block.type === "wordCloud" ? "ことばの雲" : block.type === "messages" ? "メッセージ" : "店舗名")}
        onClick={() => onSelect?.(block.id)} onPointerDown={event => pointerDown(event, block)} onPointerMove={pointerMove}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => {
          const movements: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          const delta = movements[event.key]; if (!delta) return;
          if (fullWidth && delta[0]) { event.preventDefault(); return; }
          event.preventDefault(); onSelect?.(block.id);
          const step = event.shiftKey ? 5 : 1;
          onMove?.(block.id, Math.max(0, Math.min(100 - block.width, block.x + delta[0] * step)), Math.max(0, Math.min(100 - block.height, block.y + delta[1] * step)));
        }}>{content(block)}</button>;
    })}
  </div>;
}
