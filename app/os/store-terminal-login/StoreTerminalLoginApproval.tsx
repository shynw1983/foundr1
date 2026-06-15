"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, MonitorCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { OsLanguagePicker } from "../components/OsTranslationProvider";

type TerminalAccount = {
  id: string;
  name: string;
  loginId: string;
};

type StoreOption = {
  id: string;
  name: string;
  terminalAccounts: TerminalAccount[];
};

export function StoreTerminalLoginApproval({ token }: { token: string }) {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedTerminalId, setSelectedTerminalId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) ?? null,
    [selectedStoreId, stores]
  );

  useEffect(() => {
    let isActive = true;
    async function loadApprovalOptions() {
      setIsLoading(true);
      setError("");
      const response = await fetch(`/api/store/terminal-login/approve?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { stores?: StoreOption[]; error?: string };
      if (!isActive) return;
      if (!response.ok) {
        setError(body.error ?? "承認情報を読み取れませんでした。");
        setIsLoading(false);
        return;
      }
      const nextStores = body.stores ?? [];
      setStores(nextStores);
      const firstStore = nextStores[0];
      setSelectedStoreId(firstStore?.id ?? "");
      setSelectedTerminalId(firstStore?.terminalAccounts[0]?.id ?? "");
      setIsLoading(false);
    }
    void loadApprovalOptions();
    return () => {
      isActive = false;
    };
  }, [token]);

  function handleStoreChange(storeId: string) {
    const store = stores.find((candidate) => candidate.id === storeId);
    setSelectedStoreId(storeId);
    setSelectedTerminalId(store?.terminalAccounts[0]?.id ?? "");
  }

  async function submitApproval() {
    setError("");
    setNotice("");
    setIsSubmitting(true);
    const response = await fetch("/api/store/terminal-login/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, storeId: selectedStoreId, terminalEmployeeId: selectedTerminalId })
    });
    const body = await response.json().catch(() => ({})) as { error?: string; storeName?: string; terminalName?: string };
    setIsSubmitting(false);
    if (!response.ok) {
      setError(body.error ?? "承認できませんでした。");
      return;
    }
    setApproved(true);
    setNotice(`${body.storeName ?? "店舗"} / ${body.terminalName ?? "店舗Pad"} を承認しました。`);
  }

  const loginHref = `/os/login?next=${encodeURIComponent(`/os/store-terminal-login?token=${token}`)}`;

  return (
    <main className="terminal-approval-shell">
      <section className="terminal-approval-panel">
        <OsLanguagePicker />
        <div className="terminal-approval-icon">
          {approved ? <CheckCircle2 size={28} /> : <MonitorCheck size={28} />}
        </div>
        <div>
          <p className="eyebrow">Foundr1 STORE</p>
          <h1>{approved ? "店舗端末ログインを承認しました" : "店舗端末ログイン承認"}</h1>
          <p>店舗Padにログインさせる店舗アカウントを選択してください。</p>
        </div>

        {isLoading ? (
          <div className="terminal-approval-loading"><Loader2 size={18} /> 読み込み中</div>
        ) : null}

        {!isLoading && error ? (
          <div className="login-error">
            {error}
            {error.includes("ログイン") ? (
              <a className="terminal-approval-login-link" href={loginHref}>OSにログイン</a>
            ) : null}
          </div>
        ) : null}

        {!isLoading && !error && !approved ? (
          <div className="terminal-approval-form">
            <label>
              <span>店舗</span>
              <select value={selectedStoreId} onChange={(event) => handleStoreChange(event.target.value)}>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>店舗Padアカウント</span>
              <select value={selectedTerminalId} onChange={(event) => setSelectedTerminalId(event.target.value)}>
                {(selectedStore?.terminalAccounts ?? []).map((terminal) => (
                  <option key={terminal.id} value={terminal.id}>
                    {terminal.name}{terminal.loginId ? ` / ${terminal.loginId}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {stores.length === 0 ? (
              <div className="login-error">承認できる店舗Padアカウントがありません。</div>
            ) : null}
            <button
              className="primary-button"
              type="button"
              disabled={!selectedStoreId || !selectedTerminalId || isSubmitting}
              onClick={submitApproval}
            >
              {isSubmitting ? <Loader2 size={16} /> : <ShieldCheck size={16} />}
              この店舗Padとしてログインさせる
            </button>
          </div>
        ) : null}

        {notice ? <div className="login-notice">{notice}</div> : null}
        {approved ? (
          <p className="login-help">店舗端末側の画面は自動で切り替わります。この画面は閉じて構いません。</p>
        ) : null}
        {!approved && !isLoading ? (
          <button className="login-text-button" type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> 再読み込み
          </button>
        ) : null}
      </section>
    </main>
  );
}
