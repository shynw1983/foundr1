"use client";
import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../components/OsTranslationProvider";
import { cropGeometry, drawSns, snsPresets, type SnsCrop } from "../../../lib/sns-composition";
import { photoDimensions, decodeWidth } from "../../../lib/sns-image";
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
    const [crop, setCrop] = useState<SnsCrop>({ zoom: 1, x: 0, y: 0 }), [caption, setCaption] = useState("");
    const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [format, setFormat] = useState("image/png"), [preview, setPreview] = useState(false);
    const canvas = useRef<HTMLCanvasElement>(null), fileInput = useRef<HTMLInputElement>(null), lock = useRef(false), generation = useRef(0), ownedPhoto = useRef<ImageBitmap | null>(null);
    const drag = useRef<{
        id: number;
        x: number;
        y: number;
        crop: SnsCrop;
    } | null>(null);
    useEffect(() => { let alive = true; fetch(`/api/sns?surface=${surface}`).then(r => { if (!r.ok)
        throw Error(); return r.json(); }).then(d => { if (alive) {
        setStores(d.stores);
        setStoreId(d.stores[0]?.id ?? "");
        if (!d.stores.length)
            setMessage(t("このブランドで利用できるテンプレートはありません。"));
    } }).catch(() => { if (alive)
        setMessage(t("権限を確認できません。再読み込みしてください。")); }); return () => { alive = false; }; }, [surface, t]);
    useEffect(() => { setLogo(null); if (!storeId)
        return; let alive = true; const im = new Image(); im.onload = () => { if (alive)
        setLogo(im); }; im.onerror = () => { if (alive)
        setMessage(t("ロゴを読み込めません。再読み込みしてください。")); }; im.src = `/api/sns?asset=logo&surface=${surface}&storeId=${encodeURIComponent(storeId)}`; return () => { alive = false; }; }, [storeId, surface, t]);
    useEffect(() => () => { generation.current++; ownedPhoto.current?.close(); }, []);
    useEffect(() => { if (canvas.current && logo)
        drawSns(canvas.current, photo, { width: photo?.width ?? 1080, height: photo?.height ?? 1920 }, logo, snsPresets[preset], crop); }, [photo, logo, preset, crop]);
    async function load(file?: File) {
        if (!file)
            return;
        const seq = ++generation.current;
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
    async function exportImage(share = false) {
        if (lock.current || !photo || !logo || !canvas.current)
            return;
        lock.current = true;
        setBusy(true);
        setMessage("");
        try {
            const blob = await new Promise<Blob>((resolve, reject) => canvas.current!.toBlob(b => b ? resolve(b) : reject(Error(t("画像を作成できません。"))), format, .94));
            const name = `maamaa-sns-${snsPresets[preset].id}-${Date.now()}.${format === "image/png" ? "png" : "jpg"}`;
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
                    throw Error(t("このAppは画像保存に未対応です。ブラウザで開いて保存してください。"));
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
    return <section className="sns-editor">
    <header><h1>{t(surface === "os" ? "SNSテンプレート" : "SNS素材作成")}</h1><p>{t("写真を切り抜き、完全なロゴを重ねます。写真は端末内で処理します。")}</p></header>
    <div className="sns-workspace"><div className="sns-controls">
      <label>{t("店舗")}<select value={storeId} onChange={e => setStoreId(e.target.value)}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; void load(f); }}/>
      <button className="primary" disabled={!logo || loading || busy} onClick={() => fileInput.current?.click()}>{t(loading ? "写真を読み込み中…" : "写真を選択")}</button>
      <fieldset><legend>{t("ロゴプリセット")}</legend>{snsPresets.map((p, i) => <button key={p.id} aria-pressed={i === preset} disabled={busy} onClick={() => setPreset(i)}>{t(p.label)}<small>{p.width} × {p.height}px</small></button>)}</fieldset>
      <label>{t("拡大")}<input aria-label={t("拡大")} type="range" min="1" max="4" step="0.01" disabled={!photo || preview || busy} value={crop.zoom} onChange={e => setCrop(c => ({ ...c, zoom: Number(e.target.value) }))}/></label>
      <div className="sns-actions"><button disabled={!photo || busy} onClick={() => setCrop({ zoom: 1, x: 0, y: 0 })}>{t("構図をリセット")}</button><button aria-pressed={preview} disabled={busy} onClick={() => setPreview(!preview)}>{t(preview ? "編集に戻る" : "プレビュー")}</button></div>
      <p>{t("写真をドラッグして位置を調整できます。矢印キーでも移動できます。")}</p>
      <label>{t("画像形式")}<select disabled={busy} value={format} onChange={e => setFormat(e.target.value)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></label>
      <div className="sns-actions"><button className="primary" disabled={!photo || !logo || busy || loading} onClick={() => void exportImage()}>{t(busy ? "画像を作成中…" : "画像を保存")}</button><button disabled={!photo || !logo || busy || loading} onClick={() => void exportImage(true)}>{t("画像を共有")}</button></div>
      <p>1080 × 1920px · {t("Instagramへの投稿はご自身で行ってください。")}</p>
      <label>{t("投稿文（画像には入りません）")}<textarea value={caption} onChange={e => setCaption(e.target.value)}/></label>
      <button disabled={!caption} onClick={() => void navigator.clipboard.writeText(caption).then(() => setMessage(t("投稿文をコピーしました。"))).catch(() => setMessage(t("コピーできません。投稿文を選択してコピーしてください。")))}>{t("投稿文をコピー")}</button>
      <p role="status" aria-live="polite">{message}</p>
    </div><div className="sns-stage"><canvas ref={canvas} tabIndex={0} aria-label={t("SNS画像プレビュー")} width="1080" height="1920" style={{ touchAction: preview ? "auto" : "none" }} onPointerDown={e => { if (!photo || preview || busy)
        return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, crop }; }} onPointerMove={e => { const d = drag.current; if (!d || d.id !== e.pointerId || !photo)
        return; const ratio = 1080 / e.currentTarget.getBoundingClientRect().width; const next = { ...d.crop, x: d.crop.x + (e.clientX - d.x) * ratio, y: d.crop.y + (e.clientY - d.y) * ratio }; const g = cropGeometry(photo.width, photo.height, next); setCrop({ ...next, x: g.x - (1080 - g.width) / 2, y: g.y - (1920 - g.height) / 2 }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={e => { if (!photo || preview || busy || !e.key.startsWith("Arrow"))
        return; e.preventDefault(); setCrop(c => ({ ...c, x: c.x + (e.key === "ArrowLeft" ? -20 : e.key === "ArrowRight" ? 20 : 0), y: c.y + (e.key === "ArrowUp" ? -20 : e.key === "ArrowDown" ? 20 : 0) })); }}/>
      <span>{t(snsPresets[preset].label)} · 1080 × 1920</span></div></div>
  </section>;
}
