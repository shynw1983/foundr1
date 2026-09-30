"use client";

import { ArrowDown, ArrowUp, Check, CircleAlert, LoaderCircle, Moon, Pencil, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import type { StoreDevice } from "../../../lib/store-device-state";
import { sceneActions, sceneMaxCount, sceneMaxSteps, sceneReasonLabels, sceneRunLifetimeMs, type SceneAction, type SceneRun, type SceneStep, type SceneView, type StoreScene } from "../../../lib/store-scene-state";
import { sceneIcon, sceneIconOptions } from "../../../lib/store-scene-icons";
import { StoreSceneIcon } from "./StoreSceneIcon";

const labels: Record<SceneAction, string> = { turnOn: "オンにする", turnOff: "オフにする", press: "スイッチを押す", setPosition: "位置を指定", lock: "施錠する", unlock: "解錠する" };
const statuses = { waiting: "待機中", running: "状態確認・送信中", sent: "送信済み", skipped: "スキップ", failed: "未実行", unknown: "結果未確認", not_run: "未実行" };
const genericError = "シーンを処理できません。再読込して結果を確認してください。";
const lightHelp = "室内照明の消灯は、明るさ10–20のときだけ押します。1–9または取得できない場合は押しません。";
type Confirmation = { kind: "run" | "delete"; scene: StoreScene };
class SceneApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export function StoreScenesPanel({ storeId, storeName, devices, disabled, onRunningChange, onFinished }: {
  storeId: string; storeName: string; devices: StoreDevice[]; disabled: boolean;
  onRunningChange: (running: boolean) => void; onFinished: () => void;
}) {
  const { t } = useOsTranslation();
  const [view, setView] = useState<SceneView | null>(null), [run, setRun] = useState<SceneRun | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<StoreScene | null>(null), [confirmation, setConfirmation] = useState<Confirmation | null>(null), [allowUnlock, setAllowUnlock] = useState(false);
  const [editorError, setEditorError] = useState("");
  const editDialog = useRef<HTMLDialogElement>(null), confirmDialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true), mutation = useRef(false), completed = useRef("");
  const completionRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endpoint = `/api/store/devices/scenes?storeId=${encodeURIComponent(storeId)}`;
  const running = submitting || run?.status === "running";
  const selectable = devices.filter(d => d.actions.length && d.controlEnabled && sceneActions(d).length);
  const options = (device?: StoreDevice): SceneAction[] => !device ? [] : device.kind === "bot" ? sceneActions(device).filter(a => device.actions.includes(a)) : sceneActions(device);
  const stepLabel = (step: SceneStep) => step.action === "setPosition" ? step.position === 0 ? t("全開にする") : step.position === 100 ? t("全閉にする") : `${t("閉じる割合")} ${step.position}%` : t(labels[step.action]);
  const needsLightHelp = (scene: StoreScene) => scene.steps.some(s => s.action === "turnOff" && devices.find(d => d.key === s.device)?.kind === "indoorLight");
  const api = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(25_000) });
    const body = await response.json();
    if (!response.ok) throw new SceneApiError(response.status, body.error || genericError);
    return body;
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api(endpoint) as SceneView;
      if (active.current) { setView(body); setRun(body.latestRun); setError(""); }
    } catch (problem) { if (active.current) setError(problem instanceof SceneApiError ? problem.message : genericError); }
    finally { if (active.current) setLoading(false); }
  }, [api, endpoint]);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
  useEffect(() => { onRunningChange(Boolean(running)); }, [running, onRunningChange]);
  useEffect(() => () => { if (completionRefresh.current) clearTimeout(completionRefresh.current); onRunningChange(false); }, [onRunningChange]);
  useEffect(() => {
    if (draft && !editDialog.current?.open) editDialog.current?.showModal();
    if (!draft && editDialog.current?.open) editDialog.current.close();
  }, [draft]);
  useEffect(() => {
    if (confirmation && !confirmDialog.current?.open) confirmDialog.current?.showModal();
    if (!confirmation && confirmDialog.current?.open) confirmDialog.current.close();
  }, [confirmation]);
  const runId = run?.id, runStatus = run?.status;
  useEffect(() => {
    if (!runId || runStatus !== "running") return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const started = performance.now();
    const check = async () => {
      try {
        const body = await api(`${endpoint}&run=${encodeURIComponent(runId)}`);
        if (stopped || !active.current) return;
        if (body.run) {
          setRun(body.run);
          if (body.run.status !== "running") {
            setError("");
            if (completed.current !== runId) {
              completed.current = runId;
              if (completionRefresh.current) clearTimeout(completionRefresh.current);
              // Give the provider a short propagation window, then refresh once; no idle polling.
              completionRefresh.current = setTimeout(() => { if (active.current) onFinished(); }, 5_000);
            }
            return;
          }
        }
      } catch { if (!stopped && active.current) setError("通信が途切れました。再実行せず、結果を確認してください。"); }
      // Only observe this user-started run for a bounded period; no idle polling or command retry.
      if (!stopped && performance.now() - started < sceneRunLifetimeMs) timer = setTimeout(check, 5_000);
      else if (!stopped) setError("通信が途切れました。再実行せず、結果を確認してください。");
    };
    timer = setTimeout(check, 2_000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, endpoint, runId, runStatus, onFinished]);

  function newScene() {
    const first = selectable[0]; if (!first) return;
    const action = options(first)[0];
    setEditorError(""); setDraft({ id: crypto.randomUUID(), name: "", icon: "moon", steps: [{ device: first.key, action, ...(action === "setPosition" ? { position: 100 } : {}) }] });
  }
  function updateStep(index: number, next: SceneStep) { setDraft(d => d ? { ...d, steps: d.steps.map((s, i) => i === index ? next : s) } : d); }
  function moveStep(index: number, direction: number) {
    setDraft(d => {
      if (!d || index + direction < 0 || index + direction >= d.steps.length) return d;
      const steps = [...d.steps]; [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]]; return { ...d, steps };
    });
  }
  async function save(scenes: StoreScene[]) {
    if (!view || mutation.current) return;
    mutation.current = true; setSaving(true); setEditorError(""); setError("");
    try {
      const result = await api(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, revision: view.revision, scenes }) });
      if (active.current) { setView(v => v ? { ...v, ...result } : v); setDraft(null); setConfirmation(null); setNotice("シーンを保存しました。"); }
    } catch (problem) { if (active.current) { const message = problem instanceof SceneApiError ? problem.message : genericError; setEditorError(message); setError(message); } }
    finally { mutation.current = false; if (active.current) setSaving(false); }
  }
  async function execute() {
    if (!view || !confirmation || confirmation.kind !== "run" || mutation.current || running) return;
    const scene = confirmation.scene;
    if (scene.steps.some(s => s.action === "unlock") && !allowUnlock) return;
    mutation.current = true; setSubmitting(true); setError(""); setNotice(""); setConfirmation(null);
    const requestId = crypto.randomUUID();
    const pending: SceneRun = { id: requestId, sceneId: scene.id, name: scene.name, status: "running", startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + sceneRunLifetimeMs).toISOString(), finishedAt: null,
      steps: scene.steps.map(s => ({ ...s, name: devices.find(d => d.key === s.device)?.name || t("機器が見つかりません"), status: "waiting", reason: "" })) };
    try {
      const body = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, sceneId: scene.id, revision: view.revision, requestId, confirmed: true, allowUnlock }) });
      if (active.current) setRun(body.run);
    } catch (problem) {
      if (active.current) {
        // Read by the same request ID after a lost response. Never automatically submit a second run.
        setError(problem instanceof SceneApiError ? problem.message : genericError);
        if (problem instanceof SceneApiError && problem.status < 500) return;
        try { const body = await api(`${endpoint}&run=${requestId}`); if (active.current) setRun(body.run || pending); }
        catch { if (active.current) setRun(pending); }
      }
    } finally { mutation.current = false; if (active.current) setSubmitting(false); }
  }
  const hasProblem = run?.steps.some(s => ["failed", "unknown", "not_run"].includes(s.status));
  return <section className="store-scenes" aria-label={t("シーン")} data-i18n-ignore>
    <header className="store-scenes-heading"><div><h3><Moon size={18}/>{t("シーン")}</h3><p>{t("複数の機器を、決めた順番で操作します。")}</p></div>
      <div><button className="secondary-button" disabled={loading || saving || submitting} onClick={() => void load()} aria-label={t("シーンを再読込")}><RefreshCw size={15}/></button>
        <button className="secondary-button" disabled={disabled || running || !view || !selectable.length || view.scenes.length >= sceneMaxCount} onClick={newScene}><Plus size={16}/>{t("シーンを追加")}</button></div>
    </header>
    {error && <p role="alert" className="store-device-notice is-error">{t(error)}</p>}
    {notice && <p role="status" className="store-device-notice is-success">{t(notice)}</p>}
    {submitting && <p className="store-device-help" role="status">{t("シーンの実行を開始しています。")}</p>}
    {!view ? <p role="status" className="store-device-help">{t(loading ? "読み込み中" : "シーンを再読込してください。")}</p> : <div className="store-scene-list">
      {!view.scenes.length && <p className="store-device-help">{t("シーンを追加して、使う機器と操作を選んでください。")}</p>}
      {view.scenes.map(scene => <article className="store-scene" key={scene.id}>
        <div className="store-scene-title"><h4><StoreSceneIcon icon={sceneIcon(scene)}/>{t(scene.name)}</h4><button className="store-scene-edit" disabled={running || disabled} aria-label={`${t(scene.name)} ${t("編集")}`} onClick={() => { setEditorError(""); setDraft({ ...structuredClone(scene), icon: sceneIcon(scene) }); }}><Pencil size={16}/></button></div>
        <ol className="store-scene-preview">{scene.steps.map(step => <li key={step.device}><span>{t(devices.find(d => d.key === step.device)?.name || "機器が見つかりません")}</span><span>{stepLabel(step)}</span></li>)}</ol>
        <button className="primary-button store-scene-run" disabled={disabled || running || saving || !scene.steps.every(s => devices.find(d => d.key === s.device)?.controlEnabled)} onClick={() => { setAllowUnlock(false); setConfirmation({ kind: "run", scene }); }}><Play size={15}/>{t("実行")}</button>
      </article>)}
    </div>}
    {run && <div className="store-scene-result" aria-live="polite" aria-label={t("シーンの実行結果")}>
      <header><h4>{t(run.name)}</h4><span>{t(run.status === "running" ? "実行中" : run.status === "interrupted" ? "実行中断" : hasProblem ? "確認が必要な操作があります" : "処理が完了しました")}</span></header>
      <ol>{run.steps.map((step, i) => <li key={i} data-step-status={step.status}>
        <span className="store-scene-result-icon">{step.status === "running" ? <LoaderCircle size={16}/> : step.status === "sent" ? <Check size={16}/> : ["failed", "unknown"].includes(step.status) ? <CircleAlert size={16}/> : <span>{i + 1}</span>}</span>
        <div><strong>{t(step.name)}</strong><span>{stepLabel(step)}</span>{step.reason && <p>{t(sceneReasonLabels[step.reason] || "機器の接続と状態を確認してください。")}</p>}</div>
        <span className="store-scene-step-status">{t(statuses[step.status])}</span>
      </li>)}</ol>
      <p className="store-device-help">{t("送信済みは機器への指示受付です。実際の状態は機器カードで確認してください。")}</p>
    </div>}
    <dialog ref={editDialog} className="store-device-dialog store-scene-editor" aria-labelledby="scene-editor-title" onCancel={e => { if (saving) e.preventDefault(); else setDraft(null); }} onClose={() => setDraft(null)}>
      {draft && <form onSubmit={e => { e.preventDefault(); if (!view) return; const exists = view.scenes.some(s => s.id === draft.id); void save(exists ? view.scenes.map(s => s.id === draft.id ? draft : s) : [...view.scenes, draft]); }}>
        <div className="store-device-dialog-title"><h2 id="scene-editor-title">{t("シーンを編集")}</h2><button type="button" disabled={saving} aria-label={t("閉じる")} onClick={() => setDraft(null)}><X size={20}/></button></div>
        <label className="store-scene-name">{t("シーン名")}<input autoFocus required maxLength={40} value={draft.name} disabled={saving} placeholder={t("例：休憩モード")} onChange={e => setDraft(d => d ? { ...d, name: e.target.value } : d)}/></label>
        <fieldset className="store-scene-icon-picker" disabled={saving}>
          <legend>{t("シーンのアイコン")}</legend>
          <div className="store-scene-icon-options">{sceneIconOptions.map(option => <label key={option.key} className="store-scene-icon-option">
            <input type="radio" name="scene-icon" value={option.key} checked={sceneIcon(draft) === option.key} onChange={() => setDraft(d => d ? { ...d, icon: option.key } : d)}/>
            <span><StoreSceneIcon icon={option.key} size={22}/><span>{t(option.label)}</span></span>
          </label>)}</div>
        </fieldset>
        <p className="store-device-help">{t("上から順に実行します。同じ機器は1回だけ指定できます。")}</p>
        <ol className="store-scene-editor-steps">{draft.steps.map((step, index) => {
          const device = devices.find(d => d.key === step.device);
          return <li key={step.device}><div className="store-scene-step-number">{index + 1}</div><div className="store-scene-step-fields">
            <label>{t("機器")}<select value={step.device} disabled={saving} onChange={e => { const d = selectable.find(d => d.key === e.target.value)!; const action = options(d)[0]; updateStep(index, { device: d.key, action, ...(action === "setPosition" ? { position: 100 } : {}) }); }}>
              {!selectable.some(d => d.key === step.device) && <option value={step.device}>{t(device?.name || "機器が見つかりません")}</option>}
              {selectable.filter(d => d.key === step.device || !draft.steps.some(s => s.device === d.key)).map(d => <option key={d.key} value={d.key}>{t(d.name)}</option>)}
            </select></label>
            <label>{t("操作")}<select value={step.action} disabled={saving} onChange={e => { const action = e.target.value as SceneAction; updateStep(index, { device: step.device, action, ...(action === "setPosition" ? { position: 100 } : {}) }); }}>
              {!options(device).includes(step.action) && <option value={step.action}>{t("操作を選び直してください")}</option>}
              {options(device).map(action => <option key={action} value={action}>{t(labels[action])}</option>)}
            </select></label>
            {step.action === "setPosition" && <label>{t("閉じる割合")}<select value={step.position} disabled={saving} onChange={e => updateStep(index, { ...step, position: Number(e.target.value) })}>{[...new Set([0,25,50,75,100,step.position ?? 100])].sort((a,b) => a-b).map(position => <option key={position} value={position}>{position === 0 ? t("全開にする") : position === 100 ? t("全閉にする") : `${position}%`}</option>)}</select></label>}
            {device?.kind === "indoorLight" && <p className="store-scene-step-help">{t(step.action === "turnOff" ? lightHelp : "室内照明の点灯は、明るさ1–3のときだけ押します。それ以外は押しません。")}</p>}
            {step.action === "press" && <p className="store-scene-step-help">{t("スイッチを1回押します。オン・オフの状態は指定できません。")}</p>}
          </div><div className="store-scene-step-buttons"><button type="button" disabled={saving || index === 0} aria-label={`${index + 1} ${t("上へ")}`} onClick={() => moveStep(index, -1)}><ArrowUp size={16}/></button><button type="button" disabled={saving || index === draft.steps.length - 1} aria-label={`${index + 1} ${t("下へ")}`} onClick={() => moveStep(index, 1)}><ArrowDown size={16}/></button><button type="button" disabled={saving || draft.steps.length <= 1} aria-label={`${index + 1} ${t("操作を削除")}`} onClick={() => setDraft(d => d ? { ...d, steps: d.steps.filter((_, i) => i !== index) } : d)}><Trash2 size={16}/></button></div></li>;
        })}</ol>
        <button type="button" className="secondary-button" disabled={saving || draft.steps.length >= sceneMaxSteps || !selectable.some(d => !draft.steps.some(s => s.device === d.key))} onClick={() => {
          const device = selectable.find(d => !draft.steps.some(s => s.device === d.key)); if (!device) return;
          const action = options(device)[0]; setDraft({ ...draft, steps: [...draft.steps, { device: device.key, action, ...(action === "setPosition" ? { position: 100 } : {}) }] });
        }}><Plus size={15}/>{t("操作を追加")}</button>
        {editorError && <p role="alert" className="store-device-notice is-error">{t(editorError)}</p>}
        <div className="store-device-dialog-actions store-scene-editor-footer">
          {view?.scenes.some(s => s.id === draft.id) && <button type="button" className="store-scene-delete" disabled={saving} onClick={() => { setConfirmation({ kind: "delete", scene: draft }); setDraft(null); }}><Trash2 size={15}/>{t("シーンを削除")}</button>}
          <button type="button" className="secondary-button" disabled={saving} onClick={() => setDraft(null)}>{t("キャンセル")}</button><button type="submit" className="primary-button" disabled={saving || !draft.name.trim() || draft.steps.some(s => !options(devices.find(d => d.key === s.device)).includes(s.action))}>{t(saving ? "保存中" : "保存")}</button>
        </div>
      </form>}
    </dialog>
    <dialog ref={confirmDialog} className="store-device-dialog" aria-labelledby="scene-confirm-title" onCancel={e => { if (saving) e.preventDefault(); else setConfirmation(null); }} onClose={() => setConfirmation(null)}>
      {confirmation && <><div className="store-device-dialog-title"><h2 id="scene-confirm-title">{t(confirmation.kind === "run" ? "シーンの実行を確認" : "シーンを削除")}</h2><button disabled={saving} aria-label={t("閉じる")} onClick={() => setConfirmation(null)}><X size={20}/></button></div>
        <p className="store-device-dialog-name store-scene-confirm-name"><StoreSceneIcon icon={sceneIcon(confirmation.scene)} size={24}/>{t(confirmation.scene.name)}</p><p>{storeName}</p>
        {confirmation.kind === "run" ? <><ol className="store-scene-preview">{confirmation.scene.steps.map(step => <li key={step.device}><span>{t(devices.find(d => d.key === step.device)?.name || "機器が見つかりません")}</span><span>{stepLabel(step)}</span></li>)}</ol>
          {needsLightHelp(confirmation.scene) && <p className="store-device-help">{t(lightHelp)}</p>}
          <p>{t("失敗した操作は自動で再実行せず、次の機器へ進みます。")}</p>
          {confirmation.scene.steps.some(s => s.action === "unlock") && <label className="store-device-confirm-check"><input type="checkbox" checked={allowUnlock} onChange={e => setAllowUnlock(e.target.checked)}/><span>{t("ドアを開けられる状態になります。現地の安全を確認しました。")}</span></label>}
        </> : <p>{t("このシーンを一覧から削除します。機器の状態は変わりません。")}</p>}
        <div className="store-device-dialog-actions"><button className="secondary-button" disabled={saving} autoFocus onClick={() => setConfirmation(null)}>{t("キャンセル")}</button><button className="primary-button" disabled={saving || (confirmation.kind === "run" && (running || confirmation.scene.steps.some(s => s.action === "unlock") && !allowUnlock))} onClick={() => confirmation.kind === "run" ? void execute() : view && void save(view.scenes.filter(s => s.id !== confirmation.scene.id))}>{t(confirmation.kind === "run" ? "確認して実行" : "削除する")}</button></div>
      </>}
    </dialog>
  </section>;
}
