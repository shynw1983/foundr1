"use client";

import { useEffect, useState } from "react";

type PendingAction = {
  label: string;
  run: () => void;
};

type UseUnsavedChangesGuardInput = {
  isDirty: boolean;
  onSave: () => Promise<boolean>;
  title?: string;
  message?: string;
};

export function useUnsavedChangesGuard({
  isDirty,
  onSave,
  title = "未保存の変更があります",
  message = "変更を保存してから移動するか、保存せずに移動するかを選択してください。"
}: UseUnsavedChangesGuardInput) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;

    const handleLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target && target.target !== "_self") return;
      if (target.hasAttribute("download")) return;

      const href = target.href;
      if (!href || href === window.location.href) return;

      event.preventDefault();
      setPendingAction({
        label: "移動",
        run: () => {
          window.location.href = href;
        }
      });
    };

    document.addEventListener("click", handleLinkClick, true);
    return () => document.removeEventListener("click", handleLinkClick, true);
  }, [isDirty]);

  function guardAction(run: () => void, label = "移動") {
    if (!isDirty) {
      run();
      return;
    }
    setPendingAction({ label, run });
  }

  async function saveAndContinue() {
    if (!pendingAction || saving) return;
    setSaving(true);
    const saved = await onSave();
    setSaving(false);
    if (!saved) return;
    const nextAction = pendingAction;
    setPendingAction(null);
    nextAction.run();
  }

  function discardAndContinue() {
    if (!pendingAction) return;
    const nextAction = pendingAction;
    setPendingAction(null);
    nextAction.run();
  }

  const dialog = pendingAction ? (
    <div className="modal-backdrop unsaved-changes-backdrop" role="dialog" aria-modal="true" aria-labelledby="unsaved-changes-title">
      <section className="edit-modal unsaved-changes-dialog">
        <div className="modal-heading">
          <div>
            <h3 id="unsaved-changes-title">{title}</h3>
            <p>{message}</p>
          </div>
        </div>
        <div className="modal-actions unsaved-changes-actions">
          <button className="secondary-button" type="button" onClick={() => setPendingAction(null)} disabled={saving}>
            キャンセル
          </button>
          <button className="secondary-button" type="button" onClick={discardAndContinue} disabled={saving}>
            保存せず{pendingAction.label}
          </button>
          <button className="primary-button" type="button" onClick={() => void saveAndContinue()} disabled={saving}>
            {saving ? "保存中..." : `保存して${pendingAction.label}`}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return { guardAction, unsavedChangesDialog: dialog };
}
