"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createSnsTextLayers, snsTextLayouts, SNS_TEXT_MAX_FONT_SIZE, SNS_TEXT_MAX_FRAME_WIDTH, SNS_TEXT_MAX_LAYERS, SNS_TEXT_MAX_WIDTH, type SnsTextLayer } from "../../../lib/sns-typography";
import { snsFonts, snsFontStack, type SnsFontId } from "../../../lib/sns-fonts";
import { useOsTranslation } from "../components/OsTranslationProvider";
import "./sns-library-controls.css";

const colors = [
  { id: "white", value: "#ffffff", label: "白" },
  { id: "black", value: "#171c19", label: "黒" },
  { id: "brand-red", value: "#c30d23", label: "ブランドレッド" },
  { id: "coral", value: "#c43632", label: "コーラルレッド" },
  { id: "cream", value: "#fff0bd", label: "クリーム" },
] as const;

type LayoutId = Parameters<typeof createSnsTextLayers>[0];
type Props = {
  layers: SnsTextLayer[];
  selectedId: string | null;
  selectedIds: string[];
  multiSelect: boolean;
  onMultiSelectChange: (enabled: boolean) => void;
  disabled: boolean;
  onChange: (layers: SnsTextLayer[]) => void;
  onSelect: (id: string | null, additive?: boolean) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onPosition: (axis: "x" | "y", value: number) => void;
  selectionPosition: { x: number; y: number } | null;
  snapEnabled: boolean;
  onSnapEnabledChange: (enabled: boolean) => void;
  onCenter: (axis: "x" | "y") => void;
  selectedWidth: number;
  onResize: (width: number) => void;
  onScale: (factor: number) => void;
  onMatchWidths: () => void;
  favoriteColors: string[];
  onToggleFavorite: (color: string) => void;
  favoritesBusy?: boolean;
  fontsPending?: boolean;
};

function NumericInput({ value, min, max, step = 1, label, testId, disabled = false, onCommit }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  testId: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft !== null && draft.trim() !== "") {
      const next = Number(draft);
      if (Number.isFinite(next) && next !== value) onCommit(Math.max(min, Math.min(max, next)));
    }
    setDraft(null);
  }
  return <input aria-label={label} data-testid={testId} disabled={disabled} type="number" inputMode="decimal" min={min} max={max} step={step}
    value={draft ?? String(value)} onFocus={() => setDraft(String(value))} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      else if (event.key === "Escape") { event.preventDefault(); setDraft(null); }
    }} />;
}

function normalizeHex(value: string) {
  const hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex)) return `#${hex.split("").map(char => char + char).join("").toLowerCase()}`;
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

function ColorControls({ color, favoriteColors, favoritesBusy, onChange, onToggleFavorite }: {
  color: string;
  favoriteColors: string[];
  favoritesBusy: boolean;
  onChange: (color: string) => void;
  onToggleFavorite: (color: string) => void;
}) {
  const { t } = useOsTranslation();
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const canonical = normalizeHex(color) ?? "#ffffff";
  const favorites = [...new Set(favoriteColors.map(normalizeHex).filter((value): value is string => value !== null))];
  const isFavorite = favorites.includes(canonical);
  function commit() {
    if (draft === null) return;
    const next = normalizeHex(draft);
    if (!next) { setInvalid(true); return; }
    setDraft(null);
    setInvalid(false);
    onChange(next);
  }
  function choose(next: string) {
    setDraft(null);
    setInvalid(false);
    onChange(next);
  }
  return <div className="sns-text-color-section sns-library-colors">
    <span className="sns-text-label">{t("文字色")}</span>
    <div className="sns-text-colors" role="group" aria-label={t("文字色")}>
      {colors.map(value => <button type="button" key={value.id} className="sns-text-swatch" data-testid={`sns-text-color-${value.id}`} aria-label={t(value.label)} title={t(value.label)} aria-pressed={canonical === value.value} onClick={() => choose(value.value)}>
        <span aria-hidden="true" style={{ backgroundColor: value.value }} /><span>{t(value.label)}</span>
      </button>)}
    </div>
    <div className="sns-library-custom-color">
      <label className="sns-library-color-picker">{t("カスタム色")}<input type="color" aria-label={t("カスタム色")} data-testid="sns-text-color-custom" value={canonical} onChange={event => choose(event.target.value)} /></label>
      <label className="sns-library-color-hex">{t("カラーコード")}<input type="text" aria-label={t("カラーコード")} data-testid="sns-text-color-hex" data-i18n-ignore inputMode="text" autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={7}
        value={draft ?? canonical} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
        onFocus={() => setDraft(canonical)} onChange={event => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          else if (event.key === "Escape") { event.preventDefault(); setDraft(null); setInvalid(false); }
        }} /></label>
      <button type="button" className="sns-library-favorite-toggle" data-testid="sns-text-color-favorite" disabled={favoritesBusy || invalid} aria-label={t(isFavorite ? "お気に入りの色から削除" : "この色をお気に入りに保存")} title={t(isFavorite ? "お気に入りの色から削除" : "この色をお気に入りに保存")} aria-pressed={isFavorite} onClick={() => onToggleFavorite(canonical)}>
        <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
      </button>
    </div>
    {invalid && <small id={errorId} className="sns-library-color-error" role="status">{t("#から始まる3桁または6桁のカラーコードを入力してください。")}</small>}
    <div className="sns-library-favorites">
      <span className="sns-text-label">{t("お気に入りの色")}</span>
      {favorites.length ? <div className="sns-library-favorite-swatches" role="group" aria-label={t("お気に入りの色")}>
        {favorites.map(value => <button key={value} type="button" data-testid={`sns-text-favorite-${value.slice(1)}`} aria-label={t("保存色 {color}", { color: value })} aria-pressed={canonical === value} title={value} onClick={() => choose(value)}>
          <span aria-hidden="true" style={{ backgroundColor: value }} /><span data-i18n-ignore>{value}</span>
        </button>)}
      </div> : <small className="sns-text-hint">{t("星を押すと、この色をほかの端末でも使えます。")}</small>}
    </div>
  </div>;
}

export function SnsTextControls({ layers, selectedId, selectedIds, multiSelect, onMultiSelectChange, disabled, onChange, onSelect, onGroup, onUngroup, onPosition, selectionPosition, snapEnabled, onSnapEnabledChange, onCenter, selectedWidth, onResize, onScale, onMatchWidths, favoriteColors, onToggleFavorite, favoritesBusy = false, fontsPending = false }: Props) {
  const { t } = useOsTranslation();
  const [layoutId, setLayoutId] = useState<LayoutId>("cover");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusNext = useRef(false);
  const selected = layers.find(layer => layer.id === selectedId);
  const selectedIndex = selected ? layers.findIndex(layer => layer.id === selected.id) : -1;
  const selectedSet = new Set(selectedIds);
  const chosen = layers.filter(layer => selectedSet.has(layer.id));
  const groupIds = [...new Set(layers.map(layer => layer.groupId).filter((id): id is string => !!id))];
  const oneGroup = chosen.length > 1 && !!chosen[0].groupId && chosen.every(layer => layer.groupId === chosen[0].groupId);
  const hasGroup = chosen.some(layer => !!layer.groupId);
  const selectionKey = selectedIds.join("|");
  const geometryDisabled = fontsPending || !selectionPosition;
  const activeFont = snsFonts.find(font => font.id === selected?.fontFamily);

  useEffect(() => {
    if (focusNext.current && selected) {
      focusNext.current = false;
      textarea.current?.focus();
    }
  }, [selected]);

  function changeLayer(patch: Partial<SnsTextLayer>) {
    if (!selected || disabled) return;
    onChange(layers.map(layer => layer.id === selected.id ? { ...layer, ...patch } : layer));
  }
  function emptyLayer(text = ""): SnsTextLayer {
    const base = createSnsTextLayers(layoutId, "", "")[0];
    return {
      ...base, id: crypto.randomUUID(), text, fontFamily: "noto-sans-jp",
      fontSize: layers.length ? 56 : 128, x: 72,
      y: layers.length ? Math.min(1450, (selected?.y ?? 200) + 120) : base.y, width: 936,
    };
  }
  function editText(text: string) {
    if (disabled) return;
    if (selected) { changeLayer({ text }); return; }
    if (layers.length) return;
    const next = emptyLayer(text);
    onChange([next]);
    onSelect(next.id);
  }
  function addLayer() {
    if (disabled || layers.length >= SNS_TEXT_MAX_LAYERS) return;
    const next = emptyLayer();
    focusNext.current = true;
    onChange([...layers, next]);
    onSelect(next.id);
  }
  function removeLayers() {
    if (!chosen.length || disabled) return;
    const next = layers.filter(layer => !selectedSet.has(layer.id));
    onChange(next);
    onSelect(next[Math.min(Math.max(0, selectedIndex), next.length - 1)]?.id ?? null);
  }
  function applyLayout(nextLayout: LayoutId) {
    if (disabled || fontsPending) return;
    const defaults = createSnsTextLayers(nextLayout, layers[0]?.text ?? "", layers[1]?.text ?? "");
    setLayoutId(nextLayout);
    onChange(layers.map((layer, index) => index < defaults.length ? {
      ...defaults[index], id: layer.id, text: layer.text, groupId: layer.groupId,
      fontFamily: layer.fontFamily,
    } : layer));
  }

  return <fieldset className="sns-text-controls sns-library-text-controls" disabled={disabled} data-testid="sns-text-controls">
    <legend>{t("写真に載せる文字")}</legend>
    <div className="sns-text-heading">
      <p className="sns-text-hint">{t("文字を直接入力して、写真の上で配置できます。")}</p>
      <button type="button" className="sns-text-clear" data-testid="sns-text-clear" disabled={!layers.length} onClick={() => { onChange([]); onSelect(null); }}>{t("文字をすべて削除")}</button>
    </div>

    <div className="sns-text-layer-section">
      <div className="sns-library-layer-heading">
        <span className="sns-text-label">{t("編集する文字")}</span>
        <button type="button" className="sns-library-multiselect" data-testid="sns-text-multiselect" aria-pressed={multiSelect} disabled={!layers.length} onClick={() => onMultiSelectChange(!multiSelect)}>{t("複数選択")}</button>
      </div>
      <div className="sns-text-layers sns-library-layer-list" role="group" aria-label={t("文字レイヤー")}>
        {layers.map((layer, index) => <div key={layer.id} className="sns-library-layer-row" data-primary={selected?.id === layer.id}>
          {multiSelect && <input type="checkbox" data-testid={`sns-text-check-${index}`} aria-label={t("文字 {number}を選択", { number: index + 1 })} checked={selectedSet.has(layer.id)} onChange={() => onSelect(layer.id, true)} />}
          <button type="button" data-testid={`sns-text-layer-${index}`} aria-pressed={selectedSet.has(layer.id)} aria-label={t("文字 {number}", { number: index + 1 })} onClick={event => onSelect(layer.id, multiSelect || event.shiftKey || event.metaKey || event.ctrlKey)}>
            <span className="sns-text-layer-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="sns-text-layer-name" data-i18n-ignore>{layer.text.split("\n")[0] || "—"}</span>
            {layer.groupId && <span className="sns-library-group-badge" aria-label={t("グループ {number}", { number: groupIds.indexOf(layer.groupId) + 1 })}>G{groupIds.indexOf(layer.groupId) + 1}</span>}
          </button>
        </div>)}
      </div>
      <div className="sns-text-layer-tools">
        <button type="button" data-testid="sns-text-add-layer" disabled={layers.length >= SNS_TEXT_MAX_LAYERS} onClick={addLayer}>{t("文字を追加")}</button>
        <button type="button" data-testid="sns-text-delete-layer" disabled={!chosen.length} onClick={removeLayers}>{t("選択中の文字を削除")}</button>
        <small>{t("最大{count}個", { count: SNS_TEXT_MAX_LAYERS })}</small>
      </div>
      {!!chosen.length && <div className="sns-library-selection-tools">
        <span className="sns-library-selected-count" data-testid="sns-text-selected-count">{t("{count}個を選択中", { count: chosen.length })}</span>
        <button type="button" data-testid="sns-text-group" disabled={chosen.length < 2 || oneGroup} onClick={onGroup}>{t("グループ化")}</button>
        <button type="button" data-testid="sns-text-ungroup" disabled={!hasGroup} onClick={onUngroup}>{t("グループ解除")}</button>
      </div>}
    </div>

    <div className="sns-text-fields">
      <label>{selected && chosen.length > 1 ? t("文字 {number}の内容", { number: selectedIndex + 1 }) : t("文字内容")}
        <textarea ref={textarea} aria-label={t("文字内容")} data-testid="sns-text-content" data-i18n-ignore value={selected?.text ?? ""} maxLength={180} rows={3} disabled={!!layers.length && !selected}
          placeholder={t(layers.length && !selected ? "編集する文字を選択してください。" : "写真に載せる文字を入力してください。")}
          onChange={event => editText(event.target.value)} />
      </label>
      <small className="sns-text-hint">{t(chosen.length > 1 ? "内容と書式は編集中の1個に適用し、位置は選択中の文字をまとめて移動します。" : "改行でリズムを作れます。写真上の文字はドラッグでも移動できます。")}</small>

      {selected && <>
        <div className="sns-library-format-heading">
          <span className="sns-text-label">{t("文字 {number}の書式", { number: selectedIndex + 1 })}</span>
        </div>
        <div className="sns-text-row">
          <label>{t("書体")}<select aria-label={t("書体")} data-testid="sns-text-font" value={selected.fontFamily} onChange={event => changeLayer({ fontFamily: event.target.value as SnsFontId })}>
            {snsFonts.map(font => <option key={font.id} value={font.id}>{t(font.label)}</option>)}
          </select></label>
          <label>{t("太さ")}<select aria-label={t("太さ")} data-testid="sns-text-weight" value={selected.fontWeight} onChange={event => changeLayer({ fontWeight: Number(event.target.value) as SnsTextLayer["fontWeight"] })}>
            {(activeFont?.weights ?? [400, 500, 700]).map(weight => <option key={weight} value={weight}>{t(weight === 400 ? "標準" : weight === 500 ? "中太" : "太字")}</option>)}
          </select></label>
        </div>
        <div className="sns-library-font-preview" data-i18n-ignore aria-hidden="true" style={{ fontFamily: snsFontStack(selected.fontFamily), fontWeight: selected.fontWeight }}>{selected.text || "Aa あいうえお"}</div>
        <ColorControls key={selected.id} color={selected.color} favoriteColors={favoriteColors} favoritesBusy={favoritesBusy} onChange={color => changeLayer({ color })} onToggleFavorite={onToggleFavorite} />
        <label className="sns-text-checkbox"><input type="checkbox" data-testid="sns-text-shadow" checked={selected.shadow} onChange={event => changeLayer({ shadow: event.target.checked })} />{t("文字に影を付ける")}</label>

        <div className="sns-text-placement">
          <span className="sns-text-label">{t(chosen.length > 1 ? "選択範囲の位置" : "画像に対する配置")}</span>
          <div className="sns-text-row">
            <label>{t("横位置")}<div className="sns-text-number"><NumericInput key={`${selectionKey}-x`} label={t("横位置")} testId="sns-text-x" disabled={geometryDisabled} min={0} max={1080} value={Math.round(selectionPosition?.x ?? 0)} onCommit={x => onPosition("x", x)} /><span>px</span></div></label>
            <label>{t("縦位置")}<div className="sns-text-number"><NumericInput key={`${selectionKey}-y`} label={t("縦位置")} testId="sns-text-y" disabled={geometryDisabled} min={0} max={1920} value={Math.round(selectionPosition?.y ?? 0)} onCommit={y => onPosition("y", y)} /><span>px</span></div></label>
          </div>
          <div className="sns-text-row">
            <button type="button" data-testid="sns-text-center-horizontal" disabled={geometryDisabled} onClick={() => onCenter("x")}>{t("画像の左右中央へ")}</button>
            <button type="button" data-testid="sns-text-center-vertical" disabled={geometryDisabled} onClick={() => onCenter("y")}>{t("画像の上下中央へ")}</button>
          </div>
          <label className="sns-text-checkbox"><input type="checkbox" data-testid="sns-text-snap" checked={snapEnabled} onChange={event => onSnapEnabledChange(event.target.checked)} />{t("ガイドと吸着を有効にする")}</label>
          <small className="sns-text-hint">{t("中央やほかの文字の端に近づくと、ガイドを表示して吸着します。Altを押しながらドラッグすると一時解除できます。")}</small>
        </div>

        <div className="sns-text-resize">
          <label>{t("文字の実幅")}<div className="sns-text-number"><NumericInput key={`${selected.id}-visibleWidth`} label={t("文字の実幅")} testId="sns-text-visible-width" disabled={fontsPending || !selected.text.trim()} min={1} max={SNS_TEXT_MAX_WIDTH} value={Math.round(selectedWidth)} onCommit={onResize} /><span>px</span></div></label>
          <div className="sns-text-scale-tools" role="group" aria-label={t("文字を等比で拡大・縮小")}>
            <button type="button" data-testid="sns-text-scale-down" aria-label={t("文字を10%縮小")} disabled={fontsPending || !selected.text.trim() || selectedWidth <= 1} onClick={() => onScale(.9)}>−10%</button>
            <button type="button" data-testid="sns-text-scale-up" aria-label={t("文字を10%拡大")} disabled={fontsPending || !selected.text.trim() || selectedWidth >= SNS_TEXT_MAX_WIDTH} onClick={() => onScale(1.1)}>+10%</button>
          </div>
          <button type="button" data-testid="sns-text-match-widths" disabled={fontsPending || !selected.text.trim() || layers.filter(layer => layer.text.trim()).length < 2} onClick={onMatchWidths}>{t("ほかの文字をこの幅に揃える")}</button>
          <small className="sns-text-hint">{t("実際に見える文字幅です。変更すると、改行を保って文字サイズと文字間を一緒に拡大・縮小します。")}</small>
        </div>

        <details className="sns-text-detail">
          <summary>{t("文字サイズ・字間・行間")}</summary>
          <div className="sns-text-detail-content">
            <div className="sns-text-row">
              <label>{t("文字サイズ")}<div className="sns-text-number"><NumericInput key={`${selected.id}-fontSize`} label={t("文字サイズ")} testId="sns-text-size" min={.1} max={SNS_TEXT_MAX_FONT_SIZE} step={.1} value={Math.round(selected.fontSize * 100) / 100} onCommit={fontSize => changeLayer({ fontSize })} /><span>px</span></div></label>
              <label>{t("文字間")}<div className="sns-text-number"><NumericInput key={`${selected.id}-letterSpacing`} label={t("文字間")} testId="sns-text-tracking" min={-selected.fontSize * .12} max={selected.fontSize * .5} step={0.5} value={Math.round(selected.letterSpacing * 100) / 100} onCommit={letterSpacing => changeLayer({ letterSpacing })} /><span>px</span></div></label>
            </div>
            <div className="sns-text-row">
              <label>{t("行間")}<div className="sns-text-number"><NumericInput key={`${selected.id}-lineHeight`} label={t("行間")} testId="sns-text-line-height" min={0.9} max={1.8} step={0.05} value={selected.lineHeight} onCommit={lineHeight => changeLayer({ lineHeight })} /><span>×</span></div></label>
              <label>{t("折り返し幅")}<div className="sns-text-number"><NumericInput key={`${selected.id}-width`} label={t("折り返し幅")} testId="sns-text-width" min={.1} max={SNS_TEXT_MAX_FRAME_WIDTH} step={1} value={Math.round(selected.width * 100) / 100} onCommit={width => changeLayer({ width })} /><span>px</span></div></label>
            </div>
            <span className="sns-text-label">{t("文字揃え（テキスト枠内）")}</span>
            <div className="sns-text-align" role="group" aria-label={t("文字揃え")}>
              {([["left", "左揃え"], ["center", "中央揃え"], ["right", "右揃え"]] as const).map(([align, label]) => <button type="button" key={align} data-testid={`sns-text-align-${align}`} aria-pressed={selected.align === align} onClick={() => changeLayer({ align })}>{t(label)}</button>)}
            </div>
          </div>
        </details>
      </>}
    </div>

    {!!layers.length && <details className="sns-text-detail sns-library-layouts">
      <summary>{t("レイアウトから整える")}</summary>
      <div className="sns-text-detail-content">
        <div className="sns-text-layouts" role="group" aria-label={t("文字のレイアウト")}>
          {snsTextLayouts.map(layout => <button type="button" key={layout.id} disabled={fontsPending} data-testid={`sns-text-layout-${layout.id}`} aria-pressed={layoutId === layout.id} onClick={() => applyLayout(layout.id)}>
            <span className="sns-text-layout-preview" data-layout={layout.id} aria-hidden="true"><b>Aa</b><i /></span><span>{t(layout.label)}</span>
          </button>)}
        </div>
        <small className="sns-text-hint">{t("入力した文字とグループを保ち、最初の2個の配置を整えます。")}</small>
      </div>
    </details>}
    <small className="sns-text-hint">{t("数値は保存画像（1080 × 1920px）基準です。文字はロゴに重ならない範囲で調整されます。")}</small>
  </fieldset>;
}
