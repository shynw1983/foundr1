"use client";

import { FormEvent, useState } from "react";
import { OpsLanguagePicker } from "../components/OpsTranslationProvider";

function getDefaultPathForRole(role?: string) {
  if (role === "buyer") return "/os/procurement";
  if (role === "staff") return "/os/orders";
  if (role === "store_owner") return "/os";

  return "/os";
}

export default function OpsLoginPage() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginId, password })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "ログインできませんでした。");
      setIsSubmitting(false);
      return;
    }

    const body = await response.json().catch(() => ({})) as { employee?: { role?: string } };
    const params = new URLSearchParams(window.location.search);
    window.location.href = params.get("next") || getDefaultPathForRole(body.employee?.role);
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <OpsLanguagePicker />
        <div className="brand-mark">F1</div>
        <div>
          <p className="eyebrow">Foundr1 OS</p>
          <h1>スタッフログイン</h1>
          <p>Foundr1 OS にログイン</p>
        </div>
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
          {error ? <div className="login-error">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "ログイン中" : "ログイン"}
          </button>
        </form>
      </section>
    </main>
  );
}
