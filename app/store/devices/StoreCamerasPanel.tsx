"use client";

import { Camera, CirclePlay, RefreshCw, VideoOff, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type Pusher from "pusher-js";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { cameraErrors, cameraMaxBytes, type StoreCamera } from "../../../lib/store-camera-state";

type Capture = { ticket: string; requestId: string; channel: string; key: string; cluster: string; captureDeadline: number };
type Operation = { controller: AbortController; capture?: Capture; pusher?: Pusher; timer?: ReturnType<typeof setTimeout>; url?: string; fetching?: boolean; stopped?: boolean };
type Preview = { camera: StoreCamera; phase: "connecting" | "capturing" | "loading" | "ready" | "error"; message?: string; url?: string; capturedAt?: string };

async function post(body: Record<string, unknown>, signal?: AbortSignal, keepalive = false) {
  return fetch("/api/store/cameras", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal, cache: "no-store", keepalive });
}
async function data(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || cameraErrors.unavailable);
  return body;
}

export function StoreCamerasPanel({ storeId }: { storeId: string }) {
  const { t, language } = useOsTranslation();
  const [cameras, setCameras] = useState<StoreCamera[]>([]);
  const [listError, setListError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const operation = useRef<Operation | null>(null), dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null);
  const stop = useCallback(() => {
    const op = operation.current;
    operation.current = null;
    video.current?.pause();
    if (!op) return;
    op.stopped = true; op.controller.abort(); clearTimeout(op.timer); op.pusher?.disconnect();
    if (op.url) URL.revokeObjectURL(op.url);
    if (op.capture) void post({ action: "cancel", ticket: op.capture.ticket }, undefined, true).catch(() => {});
  }, []);
  const close = useCallback(() => { stop(); setPreview(null); }, [stop]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/store/cameras?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal: controller.signal })
      .then(data).then(body => { if (!controller.signal.aborted) { setCameras(body.cameras); setListError(""); } })
      .catch(() => { if (!controller.signal.aborted) setListError("カメラの一覧を取得できません。ページを更新してください。"); });
    return () => { controller.abort(); stop(); };
  }, [storeId, stop]);
  useEffect(() => {
    if (preview && !dialog.current?.open) dialog.current?.showModal();
    if (!preview && dialog.current?.open) dialog.current.close();
  }, [preview]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) close(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", close);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", close); };
  }, [close]);

  async function open(camera: StoreCamera) {
    stop();
    const op: Operation = { controller: new AbortController() };
    operation.current = op;
    setPreview({ camera, phase: "connecting" });
    const current = () => operation.current === op && !op.stopped;
    const fail = (message: string) => {
      if (!current()) return;
      stop(); setPreview({ camera, phase: "error", message });
    };
    try {
      const capture: Capture = await data(await post({ action: "prepare", storeId, cameraId: camera.id }, AbortSignal.any([op.controller.signal, AbortSignal.timeout(20_000)])));
      op.capture = capture;
      if (!current()) { void post({ action: "cancel", ticket: capture.ticket }, undefined, true).catch(() => {}); return; }
      op.timer = setTimeout(() => fail(cameraErrors.timeout), Math.max(0, capture.captureDeadline - Date.now()));
      const { default: PusherClient } = await import("pusher-js");
      if (!current()) return;
      const client = new PusherClient(capture.key, { cluster: capture.cluster, forceTLS: true,
        channelAuthorization: { endpoint: "/api/store/cameras", transport: "ajax", customHandler: async (params, callback) => {
          try { callback(null, await data(await post({ action: "realtime", ticket: capture.ticket, socket_id: params.socketId, channel_name: params.channelName }, op.controller.signal))); }
          catch { callback(new Error("camera_authorization_failed"), null); }
        } },
      });
      op.pusher = client;
      const channel = client.subscribe(capture.channel);
      let sent = false;
      channel.bind("pusher:subscription_succeeded", () => {
        if (!current() || sent) return;
        sent = true; setPreview({ camera, phase: "capturing" });
        void post({ action: "capture", ticket: capture.ticket }, op.controller.signal).then(data).catch(error => fail(error instanceof Error ? error.message : cameraErrors.unavailable));
      });
      channel.bind("pusher:subscription_error", () => fail(cameraErrors.unavailable));
      client.connection.bind("error", () => fail(cameraErrors.unavailable));
      channel.bind("camera.failed", (event: { requestId?: string; code?: string }) => {
        if (event.requestId === capture.requestId) fail(cameraErrors[event.code || ""] || cameraErrors.unavailable);
      });
      channel.bind("camera.ready", async (event: { requestId?: string; capturedAt?: string }) => {
        if (!current() || event.requestId !== capture.requestId || op.fetching) return;
        op.fetching = true;
        setPreview({ camera, phase: "loading" });
        try {
          const response = await post({ action: "media", ticket: capture.ticket }, AbortSignal.any([op.controller.signal, AbortSignal.timeout(30_000)]));
          if (!response.ok) { await data(response); return; }
          const clip = await response.blob();
          if (!current()) return;
          if (clip.size > cameraMaxBytes || clip.type !== "video/mp4") throw new Error(cameraErrors.playback);
          clearTimeout(op.timer); client.disconnect();
          op.url = URL.createObjectURL(clip);
          // Bound even a forgotten preview; no background capture or recurring network requests.
          op.timer = setTimeout(close, 5 * 60_000);
          setPreview({ camera, phase: "ready", url: op.url, capturedAt: event.capturedAt });
        } catch (error) { fail(error instanceof Error ? error.message : cameraErrors.unavailable); }
      });
    } catch (error) { fail(error instanceof Error ? error.message : cameraErrors.unavailable); }
  }

  if (!cameras.length && !listError) return null;
  const captured = preview?.capturedAt && Number.isFinite(Date.parse(preview.capturedAt))
    ? new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : language === "zh-Hant" ? "zh-TW" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(preview.capturedAt)) : "—";
  return <section className="store-cameras-panel store-devices-panel" aria-label={t("カメラ")} data-i18n-ignore>
    <div className="store-devices-toolbar"><div><h2>{t("カメラ")}</h2><p>{t("必要なときだけ、約10秒の映像を取得します。")}</p></div></div>
    {listError && <p className="store-device-notice is-error" role="alert">{t(listError)}</p>}
    <div className="store-device-grid">{cameras.map(camera => <article className="store-device-card store-camera-card" key={camera.id}>
      <header><div><Camera size={20} aria-hidden="true"/><h3>{t(camera.name)}</h3></div><span>{camera.model}</span></header>
      <p className="store-device-help">{t("取得するたびにカメラへ接続し、撮影後は自動で切断します。")}</p>
      <button className="primary-button" onClick={() => void open(camera)}><CirclePlay size={17} aria-hidden="true"/>{t("今の映像を取得")}</button>
    </article>)}</div>
    <dialog ref={dialog} className="store-device-dialog store-camera-dialog" onCancel={close} onClose={() => { if (operation.current || preview) close(); }} aria-labelledby="camera-preview-title">
      {preview && <><div className="store-device-dialog-title"><h2 id="camera-preview-title"><Camera size={19} aria-hidden="true"/>{t(preview.camera.name)}</h2><button aria-label={t("閉じる")} onClick={close}><X size={21}/></button></div>
        <div className="store-camera-screen" aria-busy={["connecting", "capturing", "loading"].includes(preview.phase)}>
          {preview.phase === "ready" ? <video ref={video} src={preview.url} autoPlay muted playsInline controls preload="auto" onError={() => { stop(); setPreview({ camera: preview.camera, phase: "error", message: cameraErrors.playback }); }} aria-label={t("取得した映像")}/>
            : <div className="store-camera-placeholder">{preview.phase === "error" ? <VideoOff size={32} aria-hidden="true"/> : <Camera size={32} aria-hidden="true"/>}<p role={preview.phase === "error" ? "alert" : "status"}>{t(preview.message || (preview.phase === "connecting" ? "カメラに接続しています…" : preview.phase === "capturing" ? "約10秒の映像を取得しています…" : "映像を読み込んでいます…"))}</p></div>}
        </div>
        {preview.phase === "ready" ? <p className="store-camera-caption"><span>{t("撮影日時")} · {captured}</span><span>{t("約10秒の取得済み映像")}</span></p> : <p className="store-device-help">{t("店舗のMacが起動し、インターネットに接続されている必要があります。")}</p>}
        <div className="store-device-dialog-actions"><button className="secondary-button" onClick={close}>{t("閉じる")}</button>{["ready", "error"].includes(preview.phase) && <button className="primary-button" onClick={() => void open(preview.camera)}><RefreshCw size={16}/>{t("もう一度取得")}</button>}</div>
      </>}
    </dialog>
  </section>;
}
