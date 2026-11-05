"use client";
import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { cropGeometry, drawSns, snsPresets, type SnsCrop } from "../../../lib/sns-composition";
import { photoDimensions, decodeWidth } from "../../../lib/sns-image";
import { clampSnsTextLayer, hitTestSnsText, layoutSnsText, type SnsTextLayer } from "../../../lib/sns-typography";
import { SnsTextControls } from "./SnsTextControls";
import { centerSnsTextLayer, getSnsTextVisibleBounds, type SnsSnapGuide } from "../../../lib/sns-text-alignment";
import { matchSnsTextWidths, resizeSnsTextToWidth } from "../../../lib/sns-text-resize";
import { areSnsFontsReady, ensureSnsFonts } from "../../../lib/sns-fonts";
import { cleanSnsGroups, expandSnsSelection, getSnsSelectionBounds, moveSnsSelection, snapSnsSelection } from "../../../lib/sns-selection";
import { snsCanvasBlob, snsQuery, snsRequest, SnsRequestError, uploadSnsAsset, type SnsDocument, type SnsTemplate } from "../../../lib/sns-client";
import { SnsTemplateLibrary } from "./SnsTemplateLibrary";
import "./sns.css";
type Downloads = {
    supportsImages?: () => boolean;
    saveBase64: (name: string, mime: string, data: string) => string;
};
export function SnsEditor({ surface }: {
    surface: "store" | "os";
}) {
    const { t } = useOsTranslation();
    const [stores, setStores] = useState<Array<{
        id: string;
        name: string;
    }>>([]), [storeId, setStoreId] = useState("");
    const [preset, setPreset] = useState(0), [photo, setPhoto] = useState<ImageBitmap | null>(null), [logo, setLogo] = useState<HTMLImageElement | null>(null);
    const [textLayers, setTextLayers] = useState<SnsTextLayer[]>([]);
    const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]), [multiSelect, setMultiSelect] = useState(false);
    const [resolvedLayers, setResolvedLayers] = useState<SnsTextLayer[]>([]), [fontsPending, setFontsPending] = useState(false), [fontError, setFontError] = useState(false), [fontRetry, setFontRetry] = useState(0);
    const [favoriteColors, setFavoriteColors] = useState<string[]>([]), [favoritesBusy, setFavoritesBusy] = useState(false), [favoritesReload, setFavoritesReload] = useState(0), [favoritesFailed, setFavoritesFailed] = useState(false);
    const [template, setTemplate] = useState<SnsTemplate | null>(null), [dirty, setDirty] = useState(false);
    const layersRef = useRef<SnsTextLayer[]>(textLayers), selectionRef = useRef<string[]>([]), fontGeneration = useRef(0), libraryGeneration = useRef(0), favoritesGeneration = useRef(0);
    const photoAsset = useRef<{ id: string; storeId: string; url: string } | null>(null);
    const createAttempt = useRef<{ id: string; fingerprint: string; previewAssetId: string } | null>(null);
    const [editTarget, setEditTarget] = useState<"photo" | "text">("photo");
    const [textGuide, setTextGuide] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [snapGuides, setSnapGuides] = useState<SnsSnapGuide[]>([]);
    const [textColor, setTextColor] = useState<"black" | "white">("black");
    const [crop, setCrop] = useState<SnsCrop>({ zoom: 1, x: 0, y: 0 }), [caption, setCaption] = useState("");
    const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [format, setFormat] = useState("image/png"), [preview, setPreview] = useState(false);
    const canvas = useRef<HTMLCanvasElement>(null), fileInput = useRef<HTMLInputElement>(null), lock = useRef(false), generation = useRef(0), ownedPhoto = useRef<ImageBitmap | null>(null);
    const drag = useRef<{
        id: number;
        x: number;
        y: number;
        crop: SnsCrop;
        textLayers?: SnsTextLayer[];
        ids?: string[];
        guides?: SnsSnapGuide[];
    } | null>(null);
    useEffect(() => { let alive = true; fetch(`/api/sns?surface=${surface}`).then(r => { if (!r.ok)
        throw Error(); return r.json(); }).then(d => { if (alive) {
        setStores(d.stores);
        setStoreId(current => d.stores.some((s: { id: string }) => s.id === current) ? current : d.stores[0]?.id ?? "");
        if (!d.stores.length)
            setMessage(t("このブランドで利用できるテンプレートはありません。"));
    } }).catch(() => { if (alive)
        setMessage(t("権限を確認できません。再読み込みしてください。")); }); return () => { alive = false; }; }, [surface, t]);
    useEffect(() => { setLogo(null); if (!storeId)
        return; let alive = true; const im = new Image(); im.onload = () => { if (alive)
        setLogo(im); }; im.onerror = () => { if (alive)
        setMessage(t("ロゴを読み込めません。再読み込みしてください。")); }; im.src = `/api/sns?asset=logo&color=${textColor}&surface=${surface}&storeId=${encodeURIComponent(storeId)}`; return () => { alive = false; }; }, [storeId, surface, t, textColor]);
    useEffect(() => () => { generation.current++; ownedPhoto.current?.close(); }, []);
    useEffect(() => {
        libraryGeneration.current++;
        setTemplate(null); photoAsset.current = null; createAttempt.current = null; setFavoriteColors([]);
    }, [storeId, surface]);
    useEffect(() => {
        const seq = libraryGeneration.current, requestSeq = ++favoritesGeneration.current;
        let alive = true;
        if (!storeId) return;
        setFavoritesFailed(false);
        snsRequest<{ colors: string[] }>(`/api/sns/preferences?${snsQuery(storeId, surface)}`).then(data => { if (alive && seq === libraryGeneration.current && requestSeq === favoritesGeneration.current) setFavoriteColors(data.colors); }).catch(() => { if (alive && seq === libraryGeneration.current && requestSeq === favoritesGeneration.current) setFavoritesFailed(true); });
        return () => { alive = false; };
    }, [storeId, surface, favoritesReload]);
    useEffect(() => {
        const seq = ++fontGeneration.current;
        let alive = true;
        const ready = areSnsFontsReady(textLayers);
        setFontsPending(!ready); setFontError(false); if (!ready) endDrag();
        async function resolve() {
            try {
                if (!ready) await ensureSnsFonts(textLayers);
                if (!alive || seq !== fontGeneration.current || layersRef.current !== textLayers) return;
                const ctx = canvas.current?.getContext("2d");
                const normalized = ctx ? textLayers.map(layer => clampSnsTextLayer(ctx, layer)) : textLayers;
                setResolvedLayers(normalized); setFontsPending(false);
                if (JSON.stringify(normalized) !== JSON.stringify(textLayers)) { layersRef.current = normalized; setTextLayers(normalized); }
            } catch { if (alive && seq === fontGeneration.current && layersRef.current === textLayers) { setFontsPending(false); setFontError(true); } }
        }
        void resolve();
        return () => { alive = false; };
    }, [textLayers, fontRetry]);
    useEffect(() => {
        const element = canvas.current;
        if (!element || !logo) return;
        drawSns(element, photo, { width: photo?.width ?? 1080, height: photo?.height ?? 1920 }, logo, snsPresets[preset], crop, resolvedLayers);
        const ctx = element.getContext("2d");
        setTextGuide(ctx ? getSnsSelectionBounds(ctx, resolvedLayers, selectedIds) : null);
    }, [photo, logo, preset, crop, resolvedLayers, selectedIds]);
    function endDrag() { drag.current = null; setSnapGuides([]); }
    function setSelection(ids: string[], primary?: string | null) {
        selectionRef.current = ids; setSelectedIds(ids);
        setSelectedTextId(primary && ids.includes(primary) ? primary : ids[0] ?? null);
    }
    function selectText(id: string | null, additive = false) {
        endDrag();
        if (!id) { setSelection([]); return []; }
        const group = expandSnsSelection(layersRef.current, [id]);
        const ids = additive ? selectionRef.current.includes(id) ? selectionRef.current.filter(i => !group.includes(i)) : expandSnsSelection(layersRef.current, [...selectionRef.current, ...group]) : group;
        setSelection(ids, id); setEditTarget("text"); return ids;
    }
    function commitLayers(next: SnsTextLayer[]) { layersRef.current = next; setTextLayers(next); setDirty(true); }
    function updateTextLayers(next: SnsTextLayer[]) {
        if (lock.current || preview || loading) return;
        endDrag(); next = cleanSnsGroups(next); commitLayers(next);
        const ids = expandSnsSelection(next, selectionRef.current);
        setSelection(ids.length ? ids : next[0] ? expandSnsSelection(next, [next[0].id]) : [], selectedTextId);
        setEditTarget(next.length ? "text" : "photo");
    }
    function groupText(ungroup = false) {
        if (lock.current || preview || loading) return;
        const ids = new Set(expandSnsSelection(textLayers, selectedIds));
        if (!ungroup && ids.size < 2) return;
        const groupId = crypto.randomUUID();
        if (!ungroup) setMultiSelect(false);
        updateTextLayers(textLayers.map(layer => { if (!ids.has(layer.id)) return layer; const next = { ...layer }; if (ungroup) delete next.groupId; else next.groupId = groupId; return next; }));
    }
    function positionSelection(axis: "x" | "y", value: number) {
        if (lock.current || preview || loading || fontsPending || fontError || !textGuide) return;
        const ctx = canvas.current?.getContext("2d"); if (!ctx) return;
        const delta = value - textGuide[axis];
        updateTextLayers(moveSnsSelection(ctx, textLayers, selectedIds, axis === "x" ? delta : 0, axis === "y" ? delta : 0));
    }
    async function toggleFavorite(color: string) {
        if (favoritesBusy || !storeId) return;
        const target = storeId, seq = libraryGeneration.current, requestSeq = ++favoritesGeneration.current;
        setFavoritesBusy(true);
        try {
            const data = await snsRequest<{ colors: string[] }>("/api/sns/preferences", { method: "PATCH", body: JSON.stringify({ storeId: target, surface, action: favoriteColors.includes(color.toUpperCase()) ? "remove" : "add", color }) });
            if (seq === libraryGeneration.current && requestSeq === favoritesGeneration.current) { setFavoriteColors(data.colors); setFavoritesFailed(false); }
        } catch (error) { reportError(error); } finally { setFavoritesBusy(false); }
    }
    function reportError(error: unknown) {
        if (error instanceof SnsRequestError && error.code === "palette_full") setMessage(t("お気に入りの色は32色まで保存できます。使わない色の星を外してください。"));
        else if (error instanceof SnsRequestError && error.code === "upload_expired") setMessage(t("写真の保存期限が切れました。編集内容は残っています。もう一度保存してください。"));
        else if (error instanceof SnsRequestError && error.code === "template_conflict") setMessage(t("テンプレートは別の端末で更新されています。編集内容は残っています。別名で保存するか、テンプレートを開き直してください。"));
        else if (error instanceof SnsRequestError && [401, 403].includes(error.status)) setMessage(t("保存先の権限を確認できません。店舗とログイン状態を確認してください。"));
        else setMessage(t("処理できませんでした。編集内容は残っています。通信を確認して再試行してください。"));
    }
    function resizeSelectedText(targetWidth: number) {
        if (lock.current || preview || loading || fontsPending || fontError) return;
        const ctx = canvas.current?.getContext("2d");
        const selected = textLayers.find(layer => layer.id === selectedTextId);
        if (!ctx || !selected?.text.trim()) return;
        const result = resizeSnsTextToWidth(ctx, selected, targetWidth);
        updateTextLayers(textLayers.map(layer => layer.id === selected.id ? result.layer : layer));
        setMessage(t(result.limited ? "安全範囲に合わせて文字幅を {width}px に調整しました。" : "文字幅を {width}px に調整しました。", { width: Math.round(result.width) }));
    }
    function scaleSelectedText(factor: number) {
        const ctx = canvas.current?.getContext("2d");
        const selected = textLayers.find(layer => layer.id === selectedTextId);
        const bounds = ctx && selected ? getSnsTextVisibleBounds(layoutSnsText(ctx, selected)) : null;
        if (bounds) resizeSelectedText(bounds.width * factor);
    }
    function matchTextWidths() {
        if (lock.current || preview || loading || fontsPending || fontError || !selectedTextId) return;
        const ctx = canvas.current?.getContext("2d");
        if (!ctx) return;
        const result = matchSnsTextWidths(ctx, textLayers, selectedTextId);
        if (!result.matched) {
            setMessage(t("この改行のままでは同じ幅にできません。行数や文字内容を調整してください。"));
            return;
        }
        updateTextLayers(result.layers);
        setMessage(t(result.limited ? "安全範囲内で、すべての文字を {width}px に揃えました。" : "ほかの文字を {width}px に揃えました。", { width: Math.round(result.width) }));
    }
    function movePointer(event: React.PointerEvent<HTMLCanvasElement>) {
        const current = drag.current;
        if (!current || current.id !== event.pointerId || preview || lock.current || loading || fontsPending || fontError) return;
        const ratio = 1080 / event.currentTarget.getBoundingClientRect().width;
        const dx = (event.clientX - current.x) * ratio, dy = (event.clientY - current.y) * ratio;
        if (current.textLayers && current.ids) {
            const ctx = event.currentTarget.getContext("2d"); if (!ctx) return;
            const result = snapSnsSelection(ctx, current.textLayers, current.ids, dx, dy, { scale: 1 / ratio, previousGuides: current.guides, enabled: snapEnabled, temporarilyDisabled: event.altKey });
            current.guides = result.guides; setSnapGuides(result.guides); commitLayers(result.layers);
        } else if (photo) {
            const next = { ...current.crop, x: current.crop.x + dx, y: current.crop.y + dy }, geometry = cropGeometry(photo.width, photo.height, next);
            setCrop({ ...next, x: geometry.x - (1080 - geometry.width) / 2, y: geometry.y - (1920 - geometry.height) / 2 }); setDirty(true);
        }
    }
    function startPointer(event: React.PointerEvent<HTMLCanvasElement>) {
        if (preview || lock.current || loading || !logo || fontsPending || fontError) return;
        setSnapGuides([]);
        let ids: string[] | undefined;
        if (editTarget === "text") {
            const rect = event.currentTarget.getBoundingClientRect(), ctx = event.currentTarget.getContext("2d");
            const id = ctx ? hitTestSnsText(ctx, textLayers, (event.clientX - rect.left) * 1080 / rect.width, (event.clientY - rect.top) * 1920 / rect.height) : null;
            if (!id) { if (!multiSelect) setSelection([]); return; }
            const additive = multiSelect || event.shiftKey || event.metaKey || event.ctrlKey;
            ids = selectedIds.includes(id) ? selectedIds : selectText(id, additive);
            if (!ids.includes(id)) return;
            setSelectedTextId(id);
        } else if (!photo) return;
        event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, crop, textLayers: ids ? textLayers : undefined, ids };
    }
    function centerSelectedText(axis: "x" | "y") {
        if (preview || lock.current || loading || fontsPending || fontError) return;
        const ctx = canvas.current?.getContext("2d"), selected = textLayers.find(layer => layer.id === selectedTextId);
        if (!ctx || !selected) return;
        if (selectedIds.length === 1) {
            const centered = centerSnsTextLayer(ctx, selected, axis);
            updateTextLayers(textLayers.map(layer => layer.id === centered.id ? centered : layer));
        } else {
            const b = getSnsSelectionBounds(ctx, textLayers, selectedIds); if (!b) return;
            updateTextLayers(moveSnsSelection(ctx, textLayers, selectedIds, axis === "x" ? 540 - b.x - b.width / 2 : 0, axis === "y" ? 960 - b.y - b.height / 2 : 0));
        }
    }
    function moveWithKey(event: React.KeyboardEvent<HTMLCanvasElement>) {
        if (event.key === "Alt") { if (drag.current) drag.current.guides = []; setSnapGuides([]); }
        if (preview || lock.current || loading || fontsPending || fontError || !event.key.startsWith("Arrow")) return;
        event.preventDefault(); endDrag();
        const step = event.shiftKey ? 20 : 4, dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (editTarget === "text") {
            const ctx = event.currentTarget.getContext("2d");
            if (ctx) commitLayers(moveSnsSelection(ctx, textLayers, selectedIds, dx, dy));
        } else if (photo) { setCrop(previous => ({ ...previous, x: previous.x + dx, y: previous.y + dy })); setDirty(true); }
    }
    async function load(file?: File) {
        if (!file)
            return;
        const seq = ++generation.current;
        endDrag();
        setLoading(true);
        setMessage("");
        try {
            const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
            const ascii = String.fromCharCode(...header);
            if (/hei[cf]|hevx|hevc|mif1|msf1/i.test(ascii) || /\.hei[cf]$/i.test(file.name))
                throw Error(t("HEICは未対応です。JPEGまたはPNGに変換してください。"));
            const png = header[0] === 137 && ascii.slice(1, 4) === "PNG", jpeg = header[0] === 255 && header[1] === 216;
            if (!png && !jpeg)
                throw Error(t("JPEGまたはPNGを選択してください。"));
            if (file.size > 25 * 1024 * 1024)
                throw Error(t("写真は25MB以下にしてください。"));
            // Browser applies EXIF orientation. Resize at decode to bound retained canvas memory.
            let targetWidth: number;
            try {
                const d = photoDimensions(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
                targetWidth = decodeWidth(d.width, d.height);
            }
            catch {
                throw Error(t("写真が大きすぎるか破損しています。80MP以下のJPEGまたはPNGを選択してください。"));
            }
            const bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: targetWidth, resizeQuality: "high" });
            if (seq !== generation.current) {
                bitmap.close();
                return;
            }
            if (bitmap.height > 16000) {
                bitmap.close();
                throw Error(t("縦横比が大きすぎます。写真を切り抜いてから選択してください。"));
            }
            ownedPhoto.current?.close();
            ownedPhoto.current = bitmap;
            setPhoto(bitmap);
            photoAsset.current = null; setDirty(true);
            setCrop({ zoom: 1, x: 0, y: 0 });
            setPreview(false);
        }
        catch (error) {
            if (seq === generation.current)
                setMessage(error instanceof Error ? error.message : t("写真を読み込めません。JPEGまたはPNGに変換してください。"));
        }
        finally {
            if (seq === generation.current)
                setLoading(false);
        }
    }
    async function openTemplate(summary: SnsTemplate) {
        if (lock.current) return;
        lock.current = true; endDrag(); setLoading(true); setMessage("");
        let bitmap: ImageBitmap | null = null;
        try {
            const { template: detail } = await snsRequest<{ template: SnsTemplate }>(`/api/sns/templates/${summary.id}?${snsQuery(storeId, surface)}`);
            const doc = detail.document; if (!doc) throw Error("missing_document");
            const url = `/api/sns/assets/${detail.photoAssetId}?${snsQuery(storeId, surface)}`;
            const response = await fetch(url, { cache: "no-store" }); if (!response.ok) throw new SnsRequestError(response.status, "photo_failed");
            const blob = await response.blob();
            const dimensions = photoDimensions(new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer()));
            if (dimensions.width !== doc.photoWidth || dimensions.height !== doc.photoHeight || Math.max(dimensions.width, dimensions.height) > 2160) throw Error("photo_dimensions");
            bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
            await ensureSnsFonts(doc.textLayers);
            const index = snsPresets.findIndex(p => p.id === doc.presetId); if (index < 0) throw Error("preset");
            generation.current++;
            ownedPhoto.current?.close(); ownedPhoto.current = bitmap; setPhoto(bitmap); bitmap = null;
            photoAsset.current = { id: detail.photoAssetId, storeId, url };
            setPreset(index); setTextColor(doc.logoColor); setCrop(doc.crop); setCaption(doc.caption); setFormat(doc.format);
            layersRef.current = doc.textLayers; setTextLayers(doc.textLayers); setResolvedLayers(doc.textLayers);
            setSelection(doc.textLayers[0] ? expandSnsSelection(doc.textLayers, [doc.textLayers[0].id]) : [], doc.textLayers[0]?.id);
            setEditTarget(doc.textLayers.length ? "text" : "photo"); setMultiSelect(false); setPreview(false); setTemplate(detail); setDirty(false); createAttempt.current = null;
            setMessage(t("テンプレートを開きました。文字や写真を編集できます。"));
        } finally { bitmap?.close(); setLoading(false); lock.current = false; }
    }
    async function saveTemplate(name: string, update: boolean): Promise<SnsTemplate> {
        if (lock.current || !photo || !logo || fontsPending || fontError) throw Error("not_ready");
        lock.current = true; endDrag(); setBusy(true); setMessage(t("テンプレートを保存中…"));
        try {
            const doc: SnsDocument = { version: 1, presetId: snsPresets[preset].id, logoColor: textColor, crop: { ...crop }, textLayers: textLayers.map(l => ({ ...l })), format: format as SnsDocument["format"], caption, photoWidth: photo.width, photoHeight: photo.height };
            await ensureSnsFonts(doc.textLayers);
            let asset = photoAsset.current?.storeId === storeId ? photoAsset.current : null;
            if (!asset) {
                const original = document.createElement("canvas"); original.width = photo.width; original.height = photo.height; original.getContext("2d")!.drawImage(photo, 0, 0);
                const uploaded = await uploadSnsAsset(await snsCanvasBlob(original), "photo", storeId, surface);
                asset = { id: uploaded.id, storeId, url: uploaded.url }; photoAsset.current = asset;
            }
            const fingerprint = JSON.stringify({ doc, name, storeId, photoAssetId: asset.id });
            if (createAttempt.current?.fingerprint !== fingerprint) {
                const output = document.createElement("canvas"); drawSns(output, photo, { width: photo.width, height: photo.height }, logo, snsPresets[preset], crop, doc.textLayers);
                const small = document.createElement("canvas"); small.width = 270; small.height = 480; small.getContext("2d")!.drawImage(output, 0, 0, 270, 480);
                const thumb = await uploadSnsAsset(await snsCanvasBlob(small, "image/jpeg", .82), "preview", storeId, surface);
                createAttempt.current = { id: crypto.randomUUID(), fingerprint, previewAssetId: thumb.id };
            }
            const id = update ? template!.id : createAttempt.current!.id;
            const { template: saved } = await snsRequest<{ template: SnsTemplate }>(`/api/sns/templates${update ? `/${id}` : ""}`, { method: update ? "PUT" : "POST", body: JSON.stringify({ storeId, surface, id, name, document: doc, photoAssetId: asset.id, previewAssetId: createAttempt.current.previewAssetId, ...(update ? { expectedRevision: template!.revision } : {}) }) });
            setTemplate(saved); setDirty(false); createAttempt.current = null; setMessage(t(update ? "テンプレートを更新しました。" : "テンプレートを保存しました。"));
            return saved;
        } finally { lock.current = false; setBusy(false); }
    }
    async function exportImage(share = false) {
        if (lock.current || fontsPending || fontError || !photo || !logo || !canvas.current)
            return;
        lock.current = true;
        endDrag();
        setBusy(true);
        setMessage("");
        try {
            const frozenLayers = textLayers.map(layer => ({ ...layer }));
            await ensureSnsFonts(frozenLayers);
            const output = document.createElement("canvas");
            drawSns(output, photo, { width: photo.width, height: photo.height }, logo, snsPresets[preset], crop, frozenLayers);
            const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(b => b ? resolve(b) : reject(Error(t("画像を作成できません。"))), format, .94));
            const name = `maamaa-sns-${snsPresets[preset].id}-${textColor}-${Date.now()}.${format === "image/png" ? "png" : "jpg"}`;
            const file = new File([blob], name, { type: format });
            if (share && navigator.canShare?.({ files: [file] })) {
                await navigator.share({ files: [file] });
                setMessage(t("共有先へ画像を渡しました。Instagramで投稿を確認してください。"));
                return;
            }
            if (share)
                throw Error(t("この端末では画像共有に対応していません。画像を保存してください。"));
            const bridge = (window as Window & {
                Foundr1Downloads?: Downloads;
            }).Foundr1Downloads;
            if (bridge) {
                if (!bridge.supportsImages?.())
                    throw Error(t("画像保存にはAppの更新が必要です。Appを更新してから、もう一度保存してください。"));
                const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = reject; r.readAsDataURL(blob); });
                const result = JSON.parse(bridge.saveBase64(name, format, data));
                if (!result.ok)
                    throw Error(result.error);
                setMessage(t(result.pending ? "保存権限を許可して、Downloadsを確認してください。" : "Downloadsに画像を保存しました。"));
            }
            else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                setMessage(t("画像のダウンロードを開始しました。"));
            }
        }
        catch (e) {
            if (!(e instanceof DOMException && e.name === "AbortError"))
                setMessage(e instanceof Error ? e.message : t("画像を保存できません。"));
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return <section className="sns-editor" data-i18n-ignore>
    <header><h1>{t(surface === "os" ? "SNSテンプレート" : "SNS素材作成")}</h1><p>{t("写真にロゴと文字を重ねて、SNS画像を作成します。テンプレートとして保存すると、写真と編集内容が店舗に保存されます。")}</p></header>
    <div className="sns-workspace"><div className="sns-controls">
      <label>{t("店舗")}<select disabled={busy || loading || preview} value={storeId} onChange={e => { endDrag(); setStoreId(e.target.value); setTemplate(null); photoAsset.current = null; }}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {storeId && <SnsTemplateLibrary key={storeId} storeId={storeId} surface={surface} disabled={busy || loading || preview} canSave={!!photo && !!logo && !fontsPending && !fontError} dirty={dirty} current={template} onLoad={openTemplate} onSave={saveTemplate} onError={reportError} />}
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; void load(f); }}/>
      <button className="primary" disabled={!logo || loading || busy || preview} onClick={() => fileInput.current?.click()}>{t(loading ? "写真を読み込み中…" : "写真を選択")}</button>
      <fieldset><legend>{t("ロゴプリセット")}</legend>{snsPresets.map((p, i) => <button key={p.id} aria-pressed={i === preset} disabled={busy || loading || preview} onClick={() => { endDrag(); setPreset(i); setDirty(true); }}>{t(p.label)}<small>{p.width} × {p.height}px</small></button>)}</fieldset>
      <fieldset><legend>{t("ロゴの文字色")}</legend>{(["black", "white"] as const).map(color => <button key={color} aria-pressed={textColor === color} disabled={busy || loading || preview} onClick={() => { endDrag(); setTextColor(color); setDirty(true); }}>{t(color === "black" ? "黒文字" : "白文字")}</button>)}</fieldset>
      <label>{t("拡大")}<input aria-label={t("拡大")} type="range" min="1" max="4" step="0.01" disabled={!photo || preview || busy || loading} value={crop.zoom} onChange={e => { setCrop(c => ({ ...c, zoom: Number(e.target.value) })); setDirty(true); }}/></label>
      <div className="sns-actions"><button disabled={!photo || busy || loading || preview} onClick={() => { setCrop({ zoom: 1, x: 0, y: 0 }); setDirty(true); }}>{t("構図をリセット")}</button><button aria-pressed={preview} disabled={busy || loading} onClick={() => { endDrag(); setPreview(!preview); }}>{t(preview ? "編集に戻る" : "プレビュー")}</button></div>
      <p>{t("写真をドラッグして位置を調整できます。矢印キーでも移動できます。")}</p>
      <SnsTextControls layers={textLayers} selectedId={selectedTextId} selectedIds={selectedIds} multiSelect={multiSelect} onMultiSelectChange={setMultiSelect} onGroup={() => groupText()} onUngroup={() => groupText(true)} onPosition={positionSelection} selectionPosition={textGuide ? { x: textGuide.x, y: textGuide.y } : null} favoriteColors={favoriteColors} onToggleFavorite={color => void toggleFavorite(color)} favoritesBusy={favoritesBusy} fontsPending={fontsPending || fontError} disabled={busy || loading || preview || !logo} onChange={updateTextLayers} onSelect={selectText} snapEnabled={snapEnabled} onSnapEnabledChange={enabled => { endDrag(); setSnapEnabled(enabled); }} onCenter={centerSelectedText} selectedWidth={(() => { const ctx = canvas.current?.getContext("2d"), selected = resolvedLayers.find(l => l.id === selectedTextId); return ctx && selected ? getSnsTextVisibleBounds(layoutSnsText(ctx, selected))?.width ?? 0 : 0; })()} onResize={resizeSelectedText} onScale={scaleSelectedText} onMatchWidths={matchTextWidths} />
      {(fontsPending || fontError) && <div className="sns-font-status" role="status"><span>{t(fontError ? "書体を読み込めません。通信を確認するか、別の書体を選んでください。" : "書体を読み込み中…")}</span>{fontError && <button type="button" onClick={() => setFontRetry(x => x + 1)}>{t("再試行")}</button>}</div>}
      {favoritesFailed && <div role="status"><span>{t("保存した色を読み込めません。")}</span><button type="button" onClick={() => setFavoritesReload(x => x + 1)}>{t("再試行")}</button></div>}
      <label>{t("画像形式")}<select disabled={busy || loading} value={format} onChange={e => { setFormat(e.target.value); setDirty(true); }}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></label>
      <div className="sns-actions"><button className="primary" disabled={!photo || !logo || busy || loading || fontsPending || fontError} onClick={() => void exportImage()}>{t(busy ? "画像を作成中…" : "画像を保存")}</button><button disabled={!photo || !logo || busy || loading || fontsPending || fontError} onClick={() => void exportImage(true)}>{t("画像を共有")}</button></div>
      <p>1080 × 1920px · {t("Instagramへの投稿はご自身で行ってください。")}</p>
      <label>{t("投稿文（画像には入りません）")}<textarea aria-label={t("投稿文（画像には入りません）")} maxLength={4000} disabled={busy || loading} value={caption} onChange={e => { setCaption(e.target.value); setDirty(true); }}/></label>
      <button disabled={!caption} onClick={() => void navigator.clipboard.writeText(caption).then(() => setMessage(t("投稿文をコピーしました。"))).catch(() => setMessage(t("コピーできません。投稿文を選択してコピーしてください。")))}>{t("投稿文をコピー")}</button>
      <p role="status" aria-live="polite">{message}</p>
    </div><div className={`sns-stage${preview ? " is-preview" : ""}`}>
      <div className="sns-stage-tools" role="group" aria-label={t("移動する対象")}>
        <button type="button" data-testid="sns-edit-photo" aria-pressed={editTarget === "photo"} disabled={preview || busy || loading} onClick={() => { endDrag(); setEditTarget("photo"); }}>{t("写真を移動")}</button>
        <button type="button" data-testid="sns-edit-text" aria-pressed={editTarget === "text"} disabled={!textLayers.length || preview || busy || loading} onClick={() => { endDrag(); setEditTarget("text"); if (!selectedTextId && textLayers[0]) selectText(textLayers[0].id); }}>{t("文字を移動")}</button>
      </div>
      <div className="sns-canvas-wrap">
        <canvas data-testid="sns-canvas" ref={canvas} tabIndex={0} aria-label={t("SNS画像プレビュー")} aria-describedby="sns-canvas-help" width="1080" height="1920" style={{ touchAction: preview ? "auto" : "none", cursor: preview ? "default" : editTarget === "text" ? "move" : "grab" }}
          onPointerDown={startPointer} onPointerMove={movePointer}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={moveWithKey} />
        {!preview && !fontsPending && !fontError && editTarget === "text" && textGuide ? <div className={`sns-text-guide${selectedIds.length > 1 ? " sns-text-group-guide" : ""}`} data-testid={`sns-text-bound-${textLayers.findIndex(layer => layer.id === selectedTextId)}`} data-x={textGuide.x} data-y={textGuide.y} data-width={textGuide.width} data-height={textGuide.height} data-selection-count={selectedIds.length} aria-selected="true" aria-hidden="true" style={{ left: `${textGuide.x / 10.8}%`, top: `${textGuide.y / 19.2}%`, width: `${textGuide.width / 10.8}%`, height: `${textGuide.height / 19.2}%` }} /> : null}
        {!preview && !fontsPending && !fontError && editTarget === "text" && snapGuides.map(guide => <div key={guide.axis} className={`sns-snap-guide is-${guide.axis}`} data-testid={`sns-snap-guide-${guide.axis}`} data-position={guide.position} data-kind={guide.kind} data-anchor={guide.anchor} data-source-anchor={guide.sourceAnchor} data-target={guide.layerId ?? "canvas"} aria-hidden="true"
          style={guide.axis === "x" ? { left: `${guide.position / 10.8}%` } : { top: `${guide.position / 19.2}%` }}>
          <span className="sns-snap-guide-label" style={guide.axis === "x" && guide.position > 864 ? { left: "auto", right: 4 } : undefined}>{t(guide.kind === "canvas" ? guide.axis === "x" ? "左右中央" : "上下中央" : "文字の整列")}</span>
        </div>)}
      </div>
      <span>{t(snsPresets[preset].label)} · 1080 × 1920</span>
      <p id="sns-canvas-help">{t(editTarget === "text" ? "選択した文字をまとめてドラッグ、または矢印キーで移動。Shiftで大きく移動できます。" : "写真をドラッグして構図を調整できます。")}</p>

    </div></div>
  </section>;
}
