"use client";

import { useEffect, useState } from "react";
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
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  const selectedStore = stores.find((store) => store.id === selectedStoreId);
  const selectedTerminal = selectedStore?.terminalAccounts.find((terminal) => terminal.id === selectedTerminalId);

  useEffect(() => {
    let isActive = true;
    async function loadApprovalOptions() {
      setIsLoading(true);
      setError("");
      setOptionsLoaded(false);
      setNeedsLogin(false);
      setApproved(false);
      setNotice("");
      setStores([]);
      setSelectedStoreId("");
      setSelectedTerminalId("");
      try {
        const response = await fetch(`/api/store/terminal-login/approve?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as { stores?: StoreOption[]; error?: string };
        if (!isActive) return;
        if (!response.ok) {
          setNeedsLogin(response.status === 401);
          setError(body.error ?? "承認情報を読み取れませんでした。");
          return;
        }
        const nextStores = body.stores ?? [];
        setStores(nextStores);
        // A single store is unambiguous; the device account always needs a choice.
        setSelectedStoreId(nextStores.length === 1 ? nextStores[0].id : "");
        setOptionsLoaded(true);
      } catch {
        if (isActive) setError("通信に失敗しました。通信状態を確認して、もう一度お試しください。");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }
    void loadApprovalOptions();
    return () => {
      isActive = false;
    };
  }, [token]);

  function handleStoreChange(storeId: string) {
    setSelectedStoreId(storeId);
    setSelectedTerminalId("");
    setError("");
  }

  async function submitApproval() {
    if (!selectedStore || !selectedTerminal || isSubmitting || approved) return;
    setError("");
    setNotice("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/store/terminal-login/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, storeId: selectedStore.id, terminalEmployeeId: selectedTerminal.id })
      });
      const body = await response.json().catch(() => ({})) as { error?: string; storeName?: string; terminalName?: string };
      if (!response.ok) {
        setNeedsLogin(response.status === 401);
        setError(body.error ?? "承認できませんでした。");
        return;
      }
      setApproved(true);
      setNotice(`${body.storeName ?? selectedStore.name} / ${body.terminalName ?? selectedTerminal.name}`);
    } catch {
      setError("通信に失敗しました。通信状態を確認して、もう一度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
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
          {!approved ? <p>この端末に割り当てる、登録済みの店舗端末アカウントを選択してください。</p> : null}
        </div>

        {isLoading ? (
          <div className="terminal-approval-loading"><Loader2 size={18} /> 読み込み中</div>
        ) : null}

        {!isLoading && error ? (
          <div className="login-error" role="alert">
            {error}
            {needsLogin ? (
              <a className="terminal-approval-login-link" href={loginHref}>OSにログイン</a>
            ) : null}
          </div>
        ) : null}

        {!isLoading && optionsLoaded && !needsLogin && !approved ? (
          <div className="terminal-approval-form">
            <label>
              <span>店舗</span>
              <select name="storeId" value={selectedStoreId} disabled={isSubmitting || stores.length === 0} onChange={(event) => handleStoreChange(event.target.value)}>
                <option value="" disabled>店舗を選択してください</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>店舗端末アカウント</span>
              <select name="terminalEmployeeId" value={selectedTerminalId} disabled={isSubmitting || !selectedStore?.terminalAccounts.length} onChange={(event) => {
                setSelectedTerminalId(event.target.value);
                setError("");
              }}>
                <option value="" disabled>端末アカウントを選択してください</option>
                {(selectedStore?.terminalAccounts ?? []).map((terminal) => (
                  <option key={terminal.id} value={terminal.id} data-i18n-ignore>
                    {terminal.name}{terminal.loginId ? ` / ${terminal.loginId}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="login-help">アカウントは事前に「店舗設定」の「店舗端末」で登録してください。</p>
            {stores.length === 0 ? (
              <div className="login-error">承認できる店舗がありません。</div>
            ) : selectedStore && selectedStore.terminalAccounts.length === 0 ? (
              <div className="login-error" role="status">この店舗には有効な端末アカウントがありません。「店舗設定」の「店舗端末」で登録してください。</div>
            ) : null}
            <button
              className="primary-button"
              type="button"
              disabled={!selectedStore || !selectedTerminal || isSubmitting}
              onClick={submitApproval}
            >
              {isSubmitting ? <Loader2 size={16} /> : <ShieldCheck size={16} />}
              この端末アカウントでログインさせる
            </button>
          </div>
        ) : null}

        {notice ? <div className="login-notice" role="status" data-i18n-ignore>{notice}</div> : null}
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
