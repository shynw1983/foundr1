"use client";

import { FormEvent, useState } from "react";
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
  const [mode, setMode] = useState<"login" | "initialChange" | "forgot">("login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [passwordChangeToken, setPasswordChangeToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const productName = surface === "staff" ? "Foundr1 STAFF" : surface === "store" ? "Foundr1 STORE" : "Foundr1 OS";
  const appIconSrc = surface === "staff" ? "/icons/foundr1-staff-192.png" : "/icons/foundr1-store-192.png";
  const loginTitle = surface === "store" ? "店舗ワークベンチログイン" : "スタッフログイン";
  const loginDescription = surface === "store"
    ? "店舗端末または管理者アカウントでログイン"
    : `${productName} にログイン`;

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

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginId, password, surface })
    });

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
          <h1>{mode === "forgot" ? "パスワード再設定" : mode === "initialChange" ? "新しいパスワード設定" : loginTitle}</h1>
          <p>
            {mode === "forgot"
              ? "登録メールアドレスを確認して新しいパスワードを設定します。"
              : mode === "initialChange"
                ? "初期パスワードから変更してください。"
                : loginDescription}
          </p>
        </div>
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
