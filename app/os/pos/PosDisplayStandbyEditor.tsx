"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Clock3, CalendarDays, CloudSun, Sparkles, MessageCircle, ImagePlus, Type, Store, Smartphone, Monitor, Trash2, RotateCcw } from "lucide-react";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { PosDisplayStandbyCanvas } from "../../../components/pos/PosDisplayStandbyCanvas";
import { createPosDisplayStandbyBlock, defaultPosDisplayStandbySettings, getPosDisplayStandbyWordFontSize, reconcilePosDisplayStandbyWordFontSizes, validatePosDisplayStandbySettings, type PosDisplayStandbyBlock, type PosDisplayStandbySettings } from "../../../lib/pos-display-standby";
import { translatePosDisplayStandbyError } from "../../../lib/pos-display-standby-i18n";
import { standbyCenteredAxes, standbyCenterPosition } from "../../../lib/pos-display-standby-geometry";
import styles from "./PosDisplayStandbyEditor.module.css";

type Props = { value: PosDisplayStandbySettings; onChange: (value: PosDisplayStandbySettings) => void; onSave: () => void; storeName: string; storeId: string; canManage: boolean; saving: boolean; onUploadingChange?: (uploading: boolean) => void };
type Orientation = "portrait" | "landscape";
const labels = { clock: "時計", text: "文字", image: "ロゴ・画像", storeName: "店舗名", date: "日付", weather: "天気", wordCloud: "ことばの雲", messages: "メッセージ" };
const landscapePreviewSizes = {
  phone: { width: 896, height: 414, label: "iPhone 11 横 · 896×414" },
  compact: { width: 808, height: 320, label: "ブラウザ表示の目安 · 808×320" },
  tablet: { width: 1024, height: 768, label: "タブレット横 · 4:3" },
  wide: { width: 1280, height: 720, label: "横長画面 · 16:9" }
} as const;
type LandscapePreview = keyof typeof landscapePreviewSizes;

function NumberField({ value, onCommit, ...props }: { value: number; onCommit: (value: number) => void; name: string; min: number; max: number; step: number; disabled?: boolean; "aria-label"?: string; "data-standby-word-font-size"?: number }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  function commit() {
    const number = Number(draft);
    if (draft.trim() && Number.isFinite(number)) { if (number !== value) onCommit(number); }
    else setDraft(String(value));
    setFocused(false);
  }
  return <input type="number" {...props} value={draft} onFocus={() => setFocused(true)} onChange={event => setDraft(event.target.value)}
    onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}

function FlowSlider({ label, value, min, max, unit, start, end, onChange, ...props }: {
  label: string; value: number; min: number; max: number; unit: string; start: string; end: string;
  onChange: (value: number) => void; name: string;
  "data-standby-word-density"?: boolean; "data-standby-word-size-contrast"?: boolean;
  "data-standby-word-speed-variance"?: boolean; "data-standby-animation-seconds"?: boolean;
}) {
  return <label className={styles.flowControl}>
    <span className={styles.flowControlHeading}><span>{label}</span><output aria-hidden="true" data-i18n-ignore>{value}{unit}</output></span>
    <input type="range" {...props} min={min} max={max} step={1} value={value} aria-label={label} aria-valuetext={`${value}${unit}`}
      onChange={event => onChange(event.currentTarget.valueAsNumber)} />
    <span className={styles.flowControlEnds} aria-hidden="true"><span>{start}</span><span>{end}</span></span>
  </label>;
}

function ImageUrlField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);
  return <input type="url" name="standby-imageUrl" value={draft} onFocus={() => setFocused(true)} onChange={event => setDraft(event.target.value)}
    onBlur={() => { onCommit(draft.trim()); setFocused(false); }}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}

export function PosDisplayStandbyEditor({ value, onChange, onSave, storeName, storeId, canManage, saving, onUploadingChange }: Props) {
  const { t } = useOsTranslation();
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [landscapePreview, setLandscapePreview] = useState<LandscapePreview>("phone");
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [animateSelected, setAnimateSelected] = useState(false);
  const previewAfterMotionChange = useRef<{ storeId: string; orientation: Orientation; id: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [date, setDate] = useState(() => new Date());
  const latest = useRef(value); latest.current = value;
  const notifyUpload = useRef(onUploadingChange); notifyUpload.current = onUploadingChange;
  const scope = useRef(storeId); scope.current = storeId;
  const upload = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; upload.current?.abort(); notifyUpload.current?.(false); }; }, []);
  useEffect(() => { upload.current?.abort(); setUploading(false); notifyUpload.current?.(false); setSelectedId(""); setNotice(""); }, [storeId]);
  useEffect(() => { const timer = window.setInterval(() => setDate(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  const blocks = value.layouts[orientation];
  const selected = blocks.find(block => block.id === selectedId) || blocks[0];
  const movingWords = selected?.type === "wordCloud" && selected.motion !== "still";
  const selectedPhrases = selected?.type === "wordCloud" ? selected.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
  const centered = selected ? standbyCenteredAxes(movingWords ? { ...selected, x: 0, width: 100 } : selected) : null;
  useEffect(() => {
    const pending = previewAfterMotionChange.current;
    setAnimateSelected(Boolean(pending && pending.storeId === storeId && pending.orientation === orientation && pending.id === selected?.id));
    previewAfterMotionChange.current = null;
  }, [storeId, orientation, landscapePreview, selected?.id, selected?.motion]);
  const disabled = !canManage || saving || uploading;
  const validation = validatePosDisplayStandbySettings(value);
  const previewSize = landscapePreviewSizes[landscapePreview];
  function updateBlock(id: string, patch: Partial<PosDisplayStandbyBlock>) {
    if (disabled) return;
    const current = latest.current;
    onChange({ ...current, layouts: { ...current.layouts, [orientation]: current.layouts[orientation].map(block => {
      if (block.id !== id) return block;
      const updated = { ...block, ...patch };
      if (updated.wordFontSizes === undefined) delete updated.wordFontSizes;
      return updated;
    }) } });
  }
  function updateFlow(patch: Partial<PosDisplayStandbyBlock>) {
    if (!selected || disabled) return;
    updateBlock(selected.id, patch);
    if (movingWords || patch.motion === "gentle") {
      if (selected.motion === "still" && patch.motion === "gentle") previewAfterMotionChange.current = { storeId, orientation, id: selected.id };
      setAnimateSelected(true);
    }
  }
  function updateText(text: string) {
    if (!selected) return;
    updateBlock(selected.id, { text, ...(selected.type === "wordCloud" ? {
      wordFontSizes: reconcilePosDisplayStandbyWordFontSizes(selected.text, selected.wordFontSizes, text)
    } : {}) });
  }
  function moveBlock(id: string, x: number, y: number) {
    const block = latest.current.layouts[orientation].find(item => item.id === id);
    updateBlock(id, block?.type === "wordCloud" && block.motion !== "still" ? { y } : { x, y });
  }
  function add(type: PosDisplayStandbyBlock["type"]) {
    if (disabled || blocks.length >= 16) return;
    const block = createPosDisplayStandbyBlock(type, crypto.randomUUID());
    if (type === "image") Object.assign(block, { x: 65, y: 5, width: 30, height: 20 });
    onChange({ ...value, layouts: { ...value.layouts, [orientation]: [...blocks, block] } }); setSelectedId(block.id);
  }
  async function uploadImage(file?: File) {
    if (!file || !selected || disabled) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setNotice("画像は JPG・PNG・WebP、8MB 以下を選択してください。"); return; }
    const controller = new AbortController(); upload.current = controller;
    const targetStore = storeId, targetOrientation = orientation, targetId = selected.id;
    setUploading(true); notifyUpload.current?.(true); setNotice("");
    try {
      const form = new FormData(); form.set("file", file); form.set("type", "image"); form.set("name", file.name);
      const response = await fetch("/api/os/pos/customer-display-media", { method: "POST", body: form, signal: controller.signal });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string") throw new Error(result.error || "画像をアップロードできませんでした。");
      if (!active.current || scope.current !== targetStore || controller.signal.aborted) return;
      const current = latest.current;
      onChange({ ...current, layouts: { ...current.layouts, [targetOrientation]: current.layouts[targetOrientation].map(block => block.id === targetId ? { ...block, imageUrl: result.url } : block) } });
      setNotice("画像を配置しました。待機画面を保存すると反映されます。");
    } catch (error) {
      if (active.current && scope.current === targetStore && !controller.signal.aborted) setNotice(error instanceof Error ? error.message : "画像をアップロードできませんでした。");
    } finally { if (active.current && scope.current === targetStore && upload.current === controller) { setUploading(false); notifyUpload.current?.(false); } }
  }
  function geometry(key: "x" | "y" | "width" | "height", raw: string) {
    if (!selected) return;
    if (movingWords && (key === "x" || key === "width")) return;
    const number = Number(raw); if (!Number.isFinite(number)) return;
    const precision = key === "x" || key === "y" ? 100 : 10;
    const bounded = Math.round(Math.max(key === "width" || key === "height" ? 1 : 0, Math.min(100, number)) * precision) / precision;
    if (key === "x") updateBlock(selected.id, { x: Math.min(bounded, 100 - selected.width) });
    else if (key === "y") updateBlock(selected.id, { y: Math.min(bounded, 100 - selected.height) });
    else if (key === "width") updateBlock(selected.id, { width: Math.min(bounded, 100 - selected.x) });
    else updateBlock(selected.id, { height: Math.min(bounded, 100 - selected.y) });
  }
  return <section id="pos-display-standby-settings" className={styles.section} aria-labelledby="standby-heading">
    <div className={styles.heading}><div><h4 id="standby-heading">{t("客席表示の待機画面")}</h4><p>{t("時間・文字・ロゴを配置して、お店の待機画面を作れます。")}</p></div>
      <button className="primary-button" type="button" data-standby-save disabled={disabled || Boolean(validation.error)} onClick={onSave}>{t("待機画面を保存")}</button></div>
    <label className={styles.toggle}><input type="checkbox" data-standby-enable checked={value.enabled} disabled={disabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} /><span>{t("この待機画面を使う")}</span></label>
    <p className={styles.help}>{t("会計中は注文・金額の画面に切り替わります。ON の場合、待機中の広告画像・動画よりこの画面を優先します。")}</p>
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="group" aria-label={t("画面の向き")}>
        <button type="button" data-standby-orientation="portrait" aria-pressed={orientation === "portrait"} onClick={() => { setOrientation("portrait"); setSelectedId(""); }}><Smartphone size={16} />{t("縦画面")}</button>
        <button type="button" data-standby-orientation="landscape" aria-pressed={orientation === "landscape"} onClick={() => { setOrientation("landscape"); setSelectedId(""); }}><Monitor size={16} />{t("横画面")}</button>
      </div>
      {orientation === "landscape" ? <label className={styles.previewTarget}><span>{t("プレビュー端末")}</span>
        <select data-standby-preview-target value={landscapePreview} onChange={event => setLandscapePreview(event.target.value as LandscapePreview)}>
          {Object.entries(landscapePreviewSizes).map(([key, target]) => <option key={key} value={key}>{t(target.label)}</option>)}
        </select>
      </label> : null}
      <label className={styles.background}>{t("背景色")}<input type="color" name="standby-background" value={value.backgroundColor} disabled={disabled} onChange={event => onChange({ ...value, backgroundColor: event.target.value })} /></label>
    </div>
    <div className={styles.workspace} data-standby-editor-workspace data-standby-flow-editing={selected?.type === "wordCloud" && orientation === "landscape"}>
      <div className={styles.stage}>
        <div className={styles.placementTools}>
          <label className={styles.toggle}><input type="checkbox" data-standby-snap checked={snapToGrid} disabled={disabled} onChange={event => setSnapToGrid(event.target.checked)} /><span>{t("グリッドに吸着")}</span></label>
          {centered ? <div className={styles.centerStatus} role="group" aria-label={t("部品の中央配置")}>
            <span role="img" data-standby-centered="horizontal" data-centered={centered.horizontal} aria-label={t(centered.horizontal ? "左右中央に配置済み" : "左右中央ではありません")}><span aria-hidden="true">{centered.horizontal ? "✓" : "—"}</span> {t("左右中央")}</span>
            <span role="img" data-standby-centered="vertical" data-centered={centered.vertical} aria-label={t(centered.vertical ? "上下中央に配置済み" : "上下中央ではありません")}><span aria-hidden="true">{centered.vertical ? "✓" : "—"}</span> {t("上下中央")}</span>
          </div> : null}
        </div>
        <div className={`${styles.frame} ${orientation === "portrait" ? styles.portrait : styles.landscape}`}
          data-standby-preview-device={orientation === "landscape" ? landscapePreview : "portrait"}
          style={orientation === "landscape" ? { aspectRatio: `${previewSize.width} / ${previewSize.height}`, "--standby-preview-ratio": previewSize.width / previewSize.height } as CSSProperties : undefined}>
          <PosDisplayStandbyCanvas settings={value} storeId={storeId} orientation={orientation} storeName={storeName || t("店舗名")} date={date} editing={!disabled} snapToGrid={snapToGrid} selectedId={selected?.id} animateSelected={animateSelected}
            onSelect={setSelectedId} onMove={moveBlock} />
        </div>
        <div className={styles.fullHelp}>
          <p className={styles.help}>{t("画面の部品を選び、ドラッグで移動できます。矢印キーでも位置を調整できます。")}</p>
          <p className={styles.help}>{t("吸着 ON では 5% 刻みと画面中央に揃います。矢印キー・数値入力は微調整に使えます。補助線は客席には表示されません。")}</p>
          <p className={styles.help}>{t("縦・横は別々に編集できます。客席端末の向きに合わせて自動で切り替わります。")}</p>
          {orientation === "landscape" ? <><p className={styles.help}>{t("プレビュー端末を変えても、保存する配置は変わりません。実機の表示領域は画面の余白やブラウザのバーで変わります。")}</p><p className={styles.help}>{t("時計が不要なら、部品を選んで削除できます。")}</p></> : null}
        </div>
        <details className={styles.compactHelp}><summary>{t("編集のヒント")}</summary>
          <p className={styles.help}>{t("画面の部品を選び、ドラッグで移動できます。矢印キーでも位置を調整できます。")}</p>
          <p className={styles.help}>{t("吸着 ON では 5% 刻みと画面中央に揃います。矢印キー・数値入力は微調整に使えます。補助線は客席には表示されません。")}</p>
          <p className={styles.help}>{t("縦・横は別々に編集できます。客席端末の向きに合わせて自動で切り替わります。")}</p>
          {orientation === "landscape" ? <><p className={styles.help}>{t("プレビュー端末を変えても、保存する配置は変わりません。実機の表示領域は画面の余白やブラウザのバーで変わります。")}</p><p className={styles.help}>{t("時計が不要なら、部品を選んで削除できます。")}</p></> : null}
          <p className={styles.help}>{t("会計中は注文・金額の画面に切り替わります。ON の場合、待機中の広告画像・動画よりこの画面を優先します。")}</p>
        </details>
      </div>
      <div className={styles.inspector} data-standby-inspector>
        <div className={styles.addButtons}>{([{ type: "clock", Icon: Clock3 }, { type: "date", Icon: CalendarDays }, { type: "text", Icon: Type }, { type: "wordCloud", Icon: Sparkles }, { type: "messages", Icon: MessageCircle }, { type: "weather", Icon: CloudSun }, { type: "image", Icon: ImagePlus }, { type: "storeName", Icon: Store }] as const).map(({ type, Icon }) =>
          <button type="button" key={type} data-standby-add={type} className="secondary-button" disabled={disabled || blocks.length >= 16} onClick={() => add(type)}><Icon size={16} />{t(labels[type])}</button>)}</div>
        <label>{t("編集する部品")}<select data-standby-select value={selected?.id || ""} onChange={event => setSelectedId(event.target.value)}>{!blocks.length ? <option value="">{t("部品を追加してください")}</option> : blocks.map((block, index) => <option key={block.id} value={block.id}>{index + 1}. {block.hidden ? `(${t("非表示")}) ` : ""}{t(labels[block.type])}{["text", "wordCloud", "messages"].includes(block.type) ? ` · ${block.text.slice(0, 20)}` : ""}</option>)}</select></label>
        {selected ? <fieldset disabled={disabled} className={styles.fields}>
          <label className={styles.toggle}><input type="checkbox" data-standby-block-visible checked={selected.hidden !== true} onChange={event => updateBlock(selected.id, { hidden: !event.target.checked })} /><span>{t("この部品を表示")}</span></label>
          <p className={styles.help} data-standby-visibility-help>{t(selected.hidden ? "非表示中です。内容・位置・サイズは保存され、表示をオンにすると元に戻ります。" : "一時的に使わない部品は、削除せず非表示にできます。")}</p>
          <div className={styles.centerControls} role="group" aria-label={t("部品の中央配置")}>
            <button type="button" className="secondary-button" data-standby-center="horizontal" disabled={movingWords} onClick={() => updateBlock(selected.id, { x: standbyCenterPosition(selected.width) })}>{t("左右中央に配置")}</button>
            <button type="button" className="secondary-button" data-standby-center="vertical" onClick={() => updateBlock(selected.id, { y: standbyCenterPosition(selected.height) })}>{t("上下中央に配置")}</button>
          </div>
          {["text", "wordCloud", "messages"].includes(selected.type) ? <label>{t("表示する文字")}<textarea name="standby-text" rows={selected.type === "text" ? 3 : 6} maxLength={500} value={selected.text} onChange={event => updateText(event.target.value)} /></label> : null}
          {selected.type === "wordCloud" || selected.type === "messages" ? <>
            <p className={styles.help}>{t("1行に1つずつ、12行まで入力できます。1行80文字以内です。")}</p>
            {selected.type === "wordCloud" ? <button type="button" className="secondary-button" data-standby-welcome-preset onClick={() => updateText(createPosDisplayStandbyBlock("wordCloud", selected.id).text)}>{t("多言語の歓迎文を入れる")}</button> : null}
            <label>{t("動き")}<select name="standby-motion" value={selected.motion ?? "gentle"} onChange={event => updateBlock(selected.id, { motion: event.target.value as "gentle" | "still" })}><option value="gentle">{t(selected.type === "wordCloud" ? "左から右に流す" : "ゆっくり動かす")}</option><option value="still">{t("静止")}</option></select></label>
            {selected.type === "wordCloud" ? <div className={styles.flowControls} data-standby-flow-controls role="group" aria-label={t("ことばの流れ")}>
              <div className={styles.flowControlsHeading}><span>{t("ことばの流れ")}</span><button type="button" className="secondary-button" data-standby-soft-flow-preset onClick={() => updateFlow({ wordDensity: 115, wordSizeContrast: 65, wordSpeedVariance: 18, animationSeconds: 32, wordSizeMode: "varied", motion: "gentle" })}>{t("やわらかい流れに整える")}</button></div>
              <FlowSlider name="standby-wordDensity" data-standby-word-density label={t("文字の密度")} min={50} max={180} value={selected.wordDensity ?? 100} unit="%" start={t("少なめ")} end={t("多め")} onChange={wordDensity => updateFlow({ wordDensity })} />
              <FlowSlider name="standby-wordSizeContrast" data-standby-word-size-contrast label={t("文字サイズの差")} min={0} max={100} value={selected.wordSizeMode === "uniform" ? 0 : selected.wordSizeContrast ?? 50} unit="%" start={t("均一")} end={t("大きな差")} onChange={wordSizeContrast => updateFlow({ wordSizeContrast, wordSizeMode: wordSizeContrast === 0 ? "uniform" : "varied" })} />
              <FlowSlider name="standby-animationSeconds" data-standby-animation-seconds label={t("画面幅ぶん進む時間（秒）")} min={8} max={90} value={selected.animationSeconds ?? 24} unit={t("秒")} start={t("速く")} end={t("ゆっくり")} onChange={animationSeconds => updateFlow({ animationSeconds })} />
              <FlowSlider name="standby-wordSpeedVariance" data-standby-word-speed-variance label={t("速度の差")} min={0} max={40} value={selected.wordSpeedVariance ?? 0} unit="%" start={t("同じ速度")} end={t("奥行きのある流れ")} onChange={wordSpeedVariance => updateFlow({ wordSpeedVariance })} />
              <p className={styles.help}>{t("流す設定では、調整するとプレビューが再生されます。保存するまで客席には反映されません。")}</p>
              <p className={styles.help}>{t("表示する量は、文字サイズと表示範囲によって変わります。個別に指定した文字サイズは優先されます。")}</p>
              {(selected.wordSpeedVariance ?? 0) > 0 ? <p className={styles.help}>{t("文字が大きく表示範囲が狭いときは、重ならないよう同じ速度で流れます。")}</p> : null}
            </div> : <label>{t("切り替え時間（秒）")}<NumberField key={`${selected.id}:animationSeconds`} name="standby-animationSeconds" min={8} max={90} step={1} value={selected.animationSeconds ?? 8} onCommit={animationSeconds => updateBlock(selected.id, { animationSeconds })} /></label>}
            {movingWords ? <div className={styles.animationPreview}>
              <button type="button" className="secondary-button" data-standby-animation-preview aria-pressed={animateSelected} onClick={() => setAnimateSelected(current => !current)}>{t(animateSelected ? "プレビューを止める" : "流れる動きをプレビュー")}</button>
              <p className={styles.help}>{t("停止中は配置の一覧です。実際の流れと文字サイズは、プレビューを再生して確認できます。")}</p>
            </div> : null}
            <p className={styles.help}>{t("動きを抑える端末設定では静止表示になります。")}</p>
          </> : null}
          {selected.type === "date" ? <label className={styles.toggle}><input type="checkbox" name="standby-showYear" checked={selected.showYear !== false} onChange={event => updateBlock(selected.id, { showYear: event.target.checked })} />{t("年も表示")}</label> : null}
          {selected.type === "weather" ? <>
            <label>{t("天気の表示")}<select name="standby-weatherDisplay" data-standby-weather-display value={selected.weatherDisplay ?? "details"} onChange={event => updateBlock(selected.id, { weatherDisplay: event.target.value as "details" | "icon" })}><option value="details">{t("詳しく表示")}</option><option value="icon">{t("アイコンのみ")}</option></select></label>
            <p className={styles.help}>{t("アイコンのみでは、見出し・天気の説明・気温を表示しません。大きさと位置はこの部品の設定で調整できます。")}</p>
            <p className={styles.help}>{t("客席では天気アイコンをタップすると、予報の詳細と出典を確認できます。")}</p>
            <p className={styles.help}>{t("店舗に設定された場所の今日の予報を表示します。最高・最低気温は予報値です。取得できないときは案内に切り替わります。")}</p>
          </> : null}
          {selected.type === "image" ? <><label>{t("画像を選択")}<input type="file" name="standby-image-file" accept="image/jpeg,image/png,image/webp" onChange={event => { void uploadImage(event.target.files?.[0]); event.target.value = ""; }} /></label><label>{t("画像 URL")}<ImageUrlField key={selected.id} value={selected.imageUrl} onCommit={imageUrl => updateBlock(selected.id, { imageUrl })} /></label></> : null}
          {selected.type === "clock" ? <label className={styles.toggle}><input type="checkbox" name="standby-showDate" checked={selected.showDate} onChange={event => updateBlock(selected.id, { showDate: event.target.checked })} />{t("日付も表示")}</label> : null}
          {movingWords ? <p className={styles.help}>{t("文字は画面の左端から右端まで流れます。上からの位置と高さで、流れる範囲を調整できます。")}</p> : null}
          <div className={styles.grid}>{([['x', '左から (%)'], ['y', '上から (%)'], ['width', '幅 (%)'], ['height', '高さ (%)']] as const).map(([key, label]) => <label key={key}>{t(label)}<NumberField key={`${selected.id}:${key}`} name={`standby-${key}`} min={key === "width" || key === "height" ? 1 : 0} max={100} step={key === "x" || key === "y" ? 0.01 : 0.1} value={movingWords && key === "x" ? 0 : movingWords && key === "width" ? 100 : selected[key]} disabled={movingWords && (key === "x" || key === "width")} onCommit={number => geometry(key, String(number))} /></label>)}</div>
          {selected.type !== "image" ? <><label>{t("フォント")}<select name="standby-fontFamily" value={selected.fontFamily ?? "standard"} onChange={event => updateBlock(selected.id, { fontFamily: event.target.value as PosDisplayStandbyBlock["fontFamily"] })}><option value="standard">{t("シンプル（標準）")}</option><option value="georgia">{t("クラシック（Georgia）")}</option></select></label><div className={styles.grid}><label>{t(selected.type === "wordCloud" ? "基本の文字サイズ" : "文字サイズ")}<NumberField key={`${selected.id}:fontSize`} name="standby-fontSize" min={2} max={20} step={0.5} value={selected.fontSize} onCommit={fontSize => updateBlock(selected.id, { fontSize })} /></label><label>{t("文字色")}<input type="color" name="standby-color" value={selected.color} onChange={event => updateBlock(selected.id, { color: event.target.value })} /></label></div><label>{t("文字揃え")}<select name="standby-align" value={selected.align} onChange={event => updateBlock(selected.id, { align: event.target.value as PosDisplayStandbyBlock['align'] })}><option value="left">{t("左")}</option><option value="center">{t("中央")}</option><option value="right">{t("右")}</option></select></label></> : null}
          {selected.type === "wordCloud" ? <div className={styles.phraseSizes} role="group" aria-label={t("1行ごとの文字サイズ")}>
            <div className={styles.phraseSizesHeading}><span>{t("1行ごとの文字サイズ")}</span><button type="button" className="secondary-button" data-standby-word-sizes-reset onClick={() => updateFlow({ wordFontSizes: [], wordSizeMode: "uniform", wordSizeContrast: 0 })}>{t("すべて基本サイズに揃える")}</button></div>
            <p className={styles.help}>{t("自動サイズもここで確認できます。数値を変更すると、その行だけ指定した大きさになります。")}</p>
            {selectedPhrases.slice(0, 12).map((phrase, index) => <label key={`${phrase}:${index}`} className={styles.phraseSizeRow}>
              <span className={styles.phraseText} title={phrase} data-i18n-ignore>{phrase}<small>{t(selected.wordFontSizes?.[index] != null ? "個別サイズ" : selected.wordSizeMode === "uniform" ? "基本サイズ" : "自動サイズ")}</small></span>
              <NumberField key={`${selected.id}:${phrase}:${index}`} name={`standby-wordFontSize-${index}`} data-standby-word-font-size={index} aria-label={t("{phrase}の文字サイズ", { phrase })} min={2} max={20} step={0.5} value={selected.wordFontSizes?.[index] ?? getPosDisplayStandbyWordFontSize(selected, index)} onCommit={fontSize => {
                const wordFontSizes = selectedPhrases.map((_, lineIndex) => selected.wordFontSizes?.[lineIndex] ?? null);
                wordFontSizes[index] = fontSize;
                updateBlock(selected.id, { wordFontSizes });
              }} />
            </label>)}
          </div> : null}
          <button type="button" data-standby-delete className="secondary-button" onClick={() => { onChange({ ...value, layouts: { ...value.layouts, [orientation]: blocks.filter(block => block.id !== selected.id) } }); setSelectedId(""); }}><Trash2 size={16} />{t("この部品を削除")}</button>
        </fieldset> : null}
        <button type="button" className="secondary-button" disabled={disabled} onClick={() => { if (window.confirm(t("この向きの配置を初期状態に戻しますか？"))) { onChange({ ...value, layouts: { ...value.layouts, [orientation]: defaultPosDisplayStandbySettings().layouts[orientation] } }); setSelectedId(""); } }}><RotateCcw size={15} />{t("この向きの配置をリセット")}</button>
      </div>
    </div>
    {validation.error ? <p role="alert" className={styles.error}>{translatePosDisplayStandbyError(validation.error, t)}</p> : null}
    {uploading ? <p role="status" className={styles.help}>{t("画像をアップロード中です。完了してから保存してください。")}</p> : null}
    {notice ? <p role="status" className={styles.help}>{t(notice)}</p> : null}
  </section>;
}
