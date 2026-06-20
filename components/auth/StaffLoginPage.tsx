"use client";

import { FormEvent, useEffect, useState } from "react";
import { OsLanguagePicker } from "../../app/os/components/OsTranslationProvider";

type LoginSurface = "os" | "store" | "staff";

function getSurfaceDefaultPath(surface: LoginSurface) {
  if (surface === "staff") return "/staff";
  return surface === "store" ? "/store" : "/os";
}

function isSameSurfacePath(pathname: string, surface: LoginSurface) {
  if (pathname === "/os/logout" || pathname === "/store/logout" || pathname === "/staff/logout" || pathname === "/os/privacy-consent" || pathname === "/staff/privacy-consent") return true;
  if (surface === "staff") return pathname === "/staff" || pathname.startsWith("/staff/");
  return surface === "store" ? pathname === "/store" || pathname.startsWith("/store/") : pathname === "/os" || pathname.startsWith("/os/");
}

export function StaffLoginPage({ surface = "os" }: { surface?: LoginSurface }) {
  const [mode, setMode] = useState<"login" | "terminalQr" | "initialChange" | "forgot">(surface === "store" ? "terminalQr" : "login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [passwordChangeToken, setPasswordChangeToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [terminalQr, setTerminalQr] = useState<{ token: string; qrCodeDataUrl: string; expiresAt: string } | null>(null);
  const [isQrLoading, setIsQrLoading] = useState(surface === "store");
  const [storeAuthChecked, setStoreAuthChecked] = useState(surface !== "store");
  const [qrRefreshNonce, setQrRefreshNonce] = useState(0);
  const productName = surface === "staff" ? "Foundr1 STAFF" : surface === "store" ? "Foundr1 STORE" : "Foundr1 OS";
  const appIconSrc = surface === "staff" ? "/icons/foundr1-staff-192.png" : "/icons/foundr1-store-192.png";
  const loginTitle = surface === "store" ? "店舗ワークベンチログイン" : "スタッフログイン";
  const loginDescription = surface === "store"
    ? "店舗端末または管理者アカウントでログイン"
    : `${productName} にログイン`;

  useEffect(() => {
    if (surface !== "store") return;

    let isActive = true;
    async function redirectIfAlreadyLoggedIn() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (!isActive) return;
        if (response.ok) {
          redirectAfterLogin();
          return;
        }
      } catch {
        // If the session check fails, fall back to the QR login flow.
      }
      if (isActive) setStoreAuthChecked(true);
    }

    void redirectIfAlreadyLoggedIn();
    return () => {
      isActive = false;
    };
  }, [surface]);

  useEffect(() => {
    if (surface !== "store" || mode !== "terminalQr" || !storeAuthChecked) return;

    let isActive = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    async function createQr() {
      setIsQrLoading(true);
      setError("");
      const response = await fetch("/api/store/terminal-login/request", { method: "POST" });
      const body = await response.json().catch(() => ({})) as {
        token?: string;
        qrCodeDataUrl?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!isActive) return;
      if (!response.ok || !body.token || !body.qrCodeDataUrl) {
        setError(body.error ?? "QRコードを作成できませんでした。");
        setIsQrLoading(false);
        return;
      }
      setTerminalQr({ token: body.token, qrCodeDataUrl: body.qrCodeDataUrl, expiresAt: body.expiresAt ?? "" });
      setIsQrLoading(false);

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        const statusResponse = await fetch(`/api/store/terminal-login/status?token=${encodeURIComponent(body.token ?? "")}`, { cache: "no-store" });
        const statusBody = await statusResponse.json().catch(() => ({})) as { status?: string; error?: string };
        if (!isActive) return;
        if (statusBody.status === "authenticated") {
          window.location.href = "/store";
          return;
        }
        if (statusBody.status === "expired") {
          setNotice("QRコードを更新しています。");
          await createQr();
        }
      }, 2200);

      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (isActive) void createQr();
      }, 4 * 60 * 1000);
    }

    void createQr();

    return () => {
      isActive = false;
      if (pollTimer) clearInterval(pollTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [mode, surface, qrRefreshNonce, storeAuthChecked]);

  function redirectAfterLogin() {
    const params = new URLSearchParams(window.location.search);
    const requestedNext = params.get("next") || "";
    const nextPath = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "";
    const nextUrl = nextPath ? new URL(nextPath, window.location.origin) : null;
    window.location.href = nextUrl && isSameSurfacePath(nextUrl.pathname, surface)
      ? `${nextUrl.pathname}${nextUrl.search}`
      : getSurfaceDefaultPath(surface);
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);

    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password, surface })
      });
    } catch {
      setError("ログイン通信に失敗しました。通信状態を確認して、もう一度お試しください。");
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "ログインできませんでした。");
      setIsSubmitting(false);
      return;
    }

    const body = await response.json().catch(() => ({})) as {
      requiresPasswordChange?: boolean;
      passwordChangeToken?: string;
    };
    if (body.requiresPasswordChange && body.passwordChangeToken) {
      setPasswordChangeToken(body.passwordChangeToken);
      setPassword("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setMode("initialChange");
      setIsSubmitting(false);
      setNotice("初期パスワードを確認しました。続けて新しいパスワードを設定してください。");
      return;
    }

    redirectAfterLogin();
  }

  async function submitInitialPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!newPassword || newPassword !== newPasswordConfirmation) {
      setError("新しいパスワードと確認用パスワードが一致しません。");
      return;
    }

    setIsSubmitting(true);

    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: passwordChangeToken, newPassword, newPasswordConfirmation })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "パスワードを変更できませんでした。");
      setIsSubmitting(false);
      return;
    }

    await response.json().catch(() => ({}));
    redirectAfterLogin();
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!newPassword || newPassword !== newPasswordConfirmation) {
      setError("新しいパスワードと確認用パスワードが一致しません。");
      return;
    }

    setIsSubmitting(true);

    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginId, email: resetEmail, newPassword, newPasswordConfirmation })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "パスワードを再設定できませんでした。");
      setIsSubmitting(false);
      return;
    }

    setPassword("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setResetEmail("");
    setMode("login");
    setIsSubmitting(false);
    setNotice("パスワードを再設定しました。新しいパスワードでログインしてください。");
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <OsLanguagePicker />
        {surface === "store" || surface === "staff" ? (
          <img className="login-app-icon" src={appIconSrc} alt={productName} />
        ) : (
          <div className="brand-mark">F1</div>
        )}
        <div>
          <p className="eyebrow">{productName}</p>
          <h1>{mode === "forgot" ? "パスワード再設定" : mode === "initialChange" ? "新しいパスワード設定" : mode === "terminalQr" ? "QR端末ログイン" : loginTitle}</h1>
          <p>
            {mode === "forgot"
              ? "登録メールアドレスを確認して新しいパスワードを設定します。"
              : mode === "initialChange"
                ? "初期パスワードから変更してください。"
                : mode === "terminalQr"
                  ? "管理者のスマートフォンで読み取り、店舗Padアカウントを選択します。"
                  : loginDescription}
          </p>
        </div>
        {mode === "terminalQr" ? (
          <div className="terminal-login-panel">
            <div className="terminal-login-qr-frame">
              {terminalQr?.qrCodeDataUrl ? (
                <img src={terminalQr.qrCodeDataUrl} alt="店舗端末ログインQR" />
              ) : (
                <div className="terminal-login-qr-placeholder">{isQrLoading ? "作成中" : "更新してください"}</div>
              )}
            </div>
            <div className="terminal-login-status">
              <strong>{isQrLoading ? "QRコードを作成しています" : "承認待ちです"}</strong>
              <span>有効期限内にスマートフォンで読み取ってください。</span>
            </div>
            {notice ? <div className="login-notice">{notice}</div> : null}
            {error ? <div className="login-error">{error}</div> : null}
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setNotice("");
                setError("");
                setTerminalQr(null);
                setQrRefreshNonce((current) => current + 1);
              }}
            >
              QRを更新
            </button>
            <button
              className="login-text-button"
              type="button"
              onClick={() => {
                setMode("login");
                setError("");
                setNotice("");
              }}
            >
              ログインIDでログイン
            </button>
          </div>
        ) : null}
        {mode === "login" ? (
          <form className="login-form" onSubmit={submitLogin}>
            <label>
              <span>ログインID</span>
              <input
                value={loginId}
                autoComplete="username"
                onChange={(event) => setLoginId(event.target.value)}
              />
            </label>
            <label>
              <span>パスワード</span>
              <input
                value={password}
                type="password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {notice ? <div className="login-notice">{notice}</div> : null}
            {error ? <div className="login-error">{error}</div> : null}
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "ログイン中" : "ログイン"}
            </button>
            {surface === "store" ? (
              <button
                className="login-text-button"
                type="button"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setMode("terminalQr");
                }}
              >
                QR端末ログインに戻る
              </button>
            ) : null}
            <button
              className="login-text-button"
              type="button"
              onClick={() => {
                setError("");
                setNotice("");
                setPassword("");
                setNewPassword("");
                setNewPasswordConfirmation("");
                setMode("forgot");
              }}
            >
              パスワードを忘れた場合
            </button>
          </form>
        ) : null}

        {mode === "initialChange" ? (
          <form className="login-form" onSubmit={submitInitialPasswordChange}>
            <label>
              <span>新しいパスワード</span>
              <input
                value={newPassword}
                type="password"
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              <span>新しいパスワード（確認）</span>
              <input
                value={newPasswordConfirmation}
                type="password"
                autoComplete="new-password"
                onChange={(event) => setNewPasswordConfirmation(event.target.value)}
              />
            </label>
            {notice ? <div className="login-notice">{notice}</div> : null}
            {error ? <div className="login-error">{error}</div> : null}
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "設定中" : "新しいパスワードで続行"}
            </button>
            <button
              className="login-text-button"
              type="button"
              onClick={() => {
                setMode("login");
                setPasswordChangeToken("");
                setNewPassword("");
                setNewPasswordConfirmation("");
                setError("");
                setNotice("");
              }}
            >
              ログインに戻る
            </button>
          </form>
        ) : null}

        {mode === "forgot" ? (
          <form className="login-form" onSubmit={submitPasswordReset}>
            <label>
              <span>ログインID</span>
              <input
                value={loginId}
                autoComplete="username"
                onChange={(event) => setLoginId(event.target.value)}
              />
            </label>
            <label>
              <span>登録メール</span>
              <input
                value={resetEmail}
                type="email"
                autoComplete="email"
                onChange={(event) => setResetEmail(event.target.value)}
              />
            </label>
            <label>
              <span>新しいパスワード</span>
              <input
                value={newPassword}
                type="password"
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              <span>新しいパスワード（確認）</span>
              <input
                value={newPasswordConfirmation}
                type="password"
                autoComplete="new-password"
                onChange={(event) => setNewPasswordConfirmation(event.target.value)}
              />
            </label>
            <p className="login-help">登録メールがないアカウントは、管理者に初期パスワードの再発行を依頼してください。</p>
            {notice ? <div className="login-notice">{notice}</div> : null}
            {error ? <div className="login-error">{error}</div> : null}
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "再設定中" : "パスワードを再設定"}
            </button>
            <button
              className="login-text-button"
              type="button"
              onClick={() => {
                setMode("login");
                setResetEmail("");
                setNewPassword("");
                setNewPasswordConfirmation("");
                setError("");
                setNotice("");
              }}
            >
              ログインに戻る
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
