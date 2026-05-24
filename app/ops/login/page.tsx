"use client";

import { FormEvent, useState } from "react";

function getDefaultPathForRole(role?: string) {
  if (role === "buyer") return "/ops/procurement";
  if (role === "staff") return "/ops/orders";
  if (role === "store_owner") return "/ops";

  return "/ops";
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
        <div className="brand-mark">F1</div>
        <div>
          <p className="eyebrow">Foundr1 Ops</p>
          <h1>スタッフログイン</h1>
          <p>発注管理システムにログイン</p>
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
