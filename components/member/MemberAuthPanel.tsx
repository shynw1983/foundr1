"use client";

import { useSignIn, useSignUp } from "@clerk/nextjs";
import { Apple, KeyRound, Loader2, Mail } from "lucide-react";
import { FormEvent, useState } from "react";

type MemberAuthPanelProps = {
  title?: string;
  description?: string;
  afterAuthUrl?: string;
};

type EmailFlow = "sign_in" | "sign_up";
type OAuthStrategy = "oauth_apple" | "oauth_google" | "oauth_line";

const oauthOptions: Array<{ label: string; strategy: OAuthStrategy; icon: "apple" | "google" | "line" }> = [
  { label: "Apple", strategy: "oauth_apple", icon: "apple" },
  { label: "Google", strategy: "oauth_google", icon: "google" },
  { label: "LINE", strategy: "oauth_line", icon: "line" }
];

function errorMessage(error: unknown) {
  const maybeErrors = (error as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors;
  const first = maybeErrors?.[0];
  return first?.longMessage || first?.message || "認証に失敗しました。入力内容を確認してください。";
}

export function MemberAuthPanel({
  title = "ログインまたは会員登録",
  description = "メールアドレス、Apple、Google、LINE で会員カードを表示できます。",
  afterAuthUrl = "/member"
}: MemberAuthPanelProps) {
  const { fetchStatus: signInFetchStatus, signIn } = useSignIn();
  const { fetchStatus: signUpFetchStatus, signUp } = useSignUp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailFlow, setEmailFlow] = useState<EmailFlow>("sign_in");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const authLoaded = Boolean(signIn && signUp);
  const clerkBusy = signInFetchStatus === "fetching" || signUpFetchStatus === "fetching";

  async function sendEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authLoaded) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage("メールアドレスを入力してください。");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const signInResult = await signIn.create({ identifier: normalizedEmail, signUpIfMissing: true });
      if (signInResult.error) throw signInResult.error;
      if (signIn.isTransferable) {
        const signUpResult = await signUp.create({ transfer: true });
        if (signUpResult.error) throw signUpResult.error;
        const sendResult = await signUp.verifications.sendEmailCode();
        if (sendResult.error) throw sendResult.error;
        setEmailFlow("sign_up");
      } else {
        const sendResult = await signIn.emailCode.sendCode();
        if (sendResult.error) throw sendResult.error;
        setEmailFlow("sign_in");
      }
      setCodeSent(true);
      setMessage("確認コードをメールで送信しました。");
    } catch (error) {
      try {
        const signUpResult = await signUp.create({ emailAddress: normalizedEmail });
        if (signUpResult.error) throw signUpResult.error;
        const sendResult = await signUp.verifications.sendEmailCode();
        if (sendResult.error) throw sendResult.error;
        setEmailFlow("sign_up");
        setCodeSent(true);
        setMessage("確認コードをメールで送信しました。");
      } catch (signUpError) {
        setMessage(errorMessage(signUpError) || errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authLoaded) return;
    const verificationCode = code.trim();
    if (!verificationCode) {
      setMessage("確認コードを入力してください。");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      if (emailFlow === "sign_in") {
        const verifyResult = await signIn.emailCode.verifyCode({ code: verificationCode });
        if (verifyResult.error) throw verifyResult.error;
        if (signIn.status === "complete") {
          const finalizeResult = await signIn.finalize();
          if (finalizeResult.error) throw finalizeResult.error;
          window.location.assign(afterAuthUrl);
          return;
        }
      } else {
        const verifyResult = await signUp.verifications.verifyEmailCode({ code: verificationCode });
        if (verifyResult.error) throw verifyResult.error;
        if (signUp.status === "complete") {
          const finalizeResult = await signUp.finalize();
          if (finalizeResult.error) throw finalizeResult.error;
          window.location.assign(afterAuthUrl);
          return;
        }
      }
      setMessage("認証を完了できませんでした。もう一度お試しください。");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function startOAuth(strategy: OAuthStrategy) {
    if (!authLoaded) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await signIn.sso({
        strategy,
        redirectUrl: afterAuthUrl,
        redirectCallbackUrl: "/sso-callback"
      });
      if (result.error) throw result.error;
    } catch (error) {
      setBusy(false);
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="member-auth-panel">
      <div className="member-auth-card">
        <div className="member-auth-heading">
          <span><KeyRound size={20} /></span>
          <div>
            <p className="eyebrow">Foundr1 Member</p>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>

        {!codeSent ? (
          <form className="member-auth-email-form" onSubmit={(event) => void sendEmailCode(event)}>
            <label>
              <span>メールアドレス</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                disabled={busy}
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || clerkBusy || !authLoaded}>
              {busy ? <Loader2 size={16} /> : <Mail size={16} />}
              確認コードを送る
            </button>
          </form>
        ) : (
          <form className="member-auth-email-form" onSubmit={(event) => void verifyEmailCode(event)}>
            <label>
              <span>確認コード</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\s/g, "").slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6桁のコード"
                disabled={busy}
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || clerkBusy || !authLoaded}>
              {busy ? <Loader2 size={16} /> : <KeyRound size={16} />}
              会員カードを表示
            </button>
            <button
              className="member-auth-link-button"
              type="button"
              onClick={() => {
                setCode("");
                setCodeSent(false);
                setMessage("");
              }}
              disabled={busy}
            >
              メールアドレスを変更
            </button>
          </form>
        )}

        <div className="member-auth-divider"><span>または</span></div>

        <div className="member-auth-oauth-grid">
          {oauthOptions.map((option) => (
            <button
              key={option.strategy}
              className="secondary-button member-auth-oauth-button"
              type="button"
              onClick={() => void startOAuth(option.strategy)}
              disabled={busy || clerkBusy || !authLoaded}
            >
              <span className="member-auth-provider-icon" aria-hidden="true">
                {option.icon === "apple" ? <Apple size={17} /> : option.icon === "google" ? "G" : "L"}
              </span>
              {option.label}
            </button>
          ))}
        </div>

        {message ? <p className="member-auth-message">{message}</p> : null}
      </div>
    </section>
  );
}
