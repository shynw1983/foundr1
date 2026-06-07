"use client";

import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { ClipboardEvent, FormEvent, KeyboardEvent, useRef, useState } from "react";

type MemberAuthPanelProps = {
  title?: string;
  description?: string;
  afterAuthUrl?: string;
};

type EmailFlow = "sign_in" | "sign_up";
type OAuthStrategy = "oauth_apple" | "oauth_google" | "oauth_line";
type EmailCodeFactorLike = { strategy: "email_code"; emailAddressId: string };

const oauthOptions: Array<{ label: string; strategy: OAuthStrategy; icon: "apple" | "google" | "line" }> = [
  { label: "Apple", strategy: "oauth_apple", icon: "apple" },
  { label: "Google", strategy: "oauth_google", icon: "google" },
  { label: "LINE", strategy: "oauth_line", icon: "line" }
];

const authTimeoutMs = 12000;
const codeLength = 6;

class AuthTimeoutError extends Error {
  constructor() {
    super("認証サーバーからの応答がありません。通信状態を確認して、もう一度お試しください。");
    this.name = "AuthTimeoutError";
  }
}

function errorMessage(error: unknown) {
  const maybeErrors = (error as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors;
  const first = maybeErrors?.[0];
  return first?.longMessage || first?.message || (error instanceof Error ? error.message : "") || "認証に失敗しました。入力内容を確認してください。";
}

function absoluteAuthUrl(path: string) {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

function withAuthTimeout<T>(operation: Promise<T>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new AuthTimeoutError()), authTimeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function emailCodeFactor(factors: unknown): EmailCodeFactorLike | undefined {
  if (!Array.isArray(factors)) return undefined;
  return factors.find((factor): factor is EmailCodeFactorLike => {
    return Boolean(
      factor &&
      typeof factor === "object" &&
      "strategy" in factor &&
      factor.strategy === "email_code" &&
      "emailAddressId" in factor &&
      typeof factor.emailAddressId === "string"
    );
  });
}

function GoogleProviderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.4-1.1 2.6-2.3 3.4v2.8h3.7c2.1-2 3.6-4.9 3.6-8.3Z" />
      <path fill="#34A853" d="M12 24c3.1 0 5.8-1 7.7-2.8L16 18.3c-1 .7-2.3 1.1-4 1.1-3 0-5.6-2-6.5-4.8H1.7v2.9C3.6 21.4 7.5 24 12 24Z" />
      <path fill="#FBBC05" d="M5.5 14.6c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V7.1H1.7C.9 8.7.5 10.5.5 12.3s.4 3.6 1.2 5.2l3.8-2.9Z" />
      <path fill="#EA4335" d="M12 5.2c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.8 1.4 15.1.2 12 .2 7.5.2 3.6 2.8 1.7 7.1L5.5 10C6.4 7.2 9 5.2 12 5.2Z" />
    </svg>
  );
}

function AppleProviderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path fill="currentColor" d="M16.6 12.7c0-2.4 2-3.6 2.1-3.7-1.1-1.6-2.8-1.8-3.4-1.9-1.5-.1-2.8.9-3.6.9-.7 0-1.9-.9-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3.1 2.4 1.2 0 1.7-.8 3.1-.8s1.8.8 3.1.8 2.1-1.2 2.9-2.4c.9-1.4 1.3-2.7 1.3-2.8 0-.1-2.8-1.1-2.8-3.7ZM14.3 5.6c.7-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.9-1 3 .9.1 2-.5 2.7-1.4Z" />
    </svg>
  );
}

function LineProviderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path fill="#06C755" d="M21.5 10.5c0-4.4-4.3-8-9.5-8s-9.5 3.6-9.5 8c0 3.9 3.5 7.2 8.2 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c-.1.3-.2 1.2.8.7 1-.4 5.4-3.2 7.4-5.5 1.2-1.4 1.8-3.1 1.8-5.5Z" />
      <path fill="#fff" d="M7.2 13.2h2.1c.3 0 .5-.2.5-.5s-.2-.5-.5-.5H7.7V8.7c0-.3-.2-.5-.5-.5s-.5.2-.5.5v4c0 .3.2.5.5.5Zm3.4 0c.3 0 .5-.2.5-.5v-4c0-.3-.2-.5-.5-.5s-.5.2-.5.5v4c0 .3.2.5.5.5Zm1.4 0c.3 0 .5-.2.5-.5v-2.5l2 2.8c.1.1.3.2.4.2h.2c.2-.1.3-.3.3-.5v-4c0-.3-.2-.5-.5-.5s-.5.2-.5.5v2.5l-2-2.8c-.1-.2-.3-.3-.6-.2-.2.1-.3.3-.3.5v4c0 .3.2.5.5.5Zm4.4 0h2.1c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-1.6v-1h1.6c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-1.6v-1h1.6c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-2.1c-.3 0-.5.2-.5.5v4c0 .3.2.5.5.5Z" />
    </svg>
  );
}

function ProviderIcon({ icon }: { icon: "apple" | "google" | "line" }) {
  if (icon === "apple") return <AppleProviderIcon />;
  if (icon === "google") return <GoogleProviderIcon />;
  return <LineProviderIcon />;
}

export function MemberAuthPanel({
  title = "ログインまたは会員登録",
  description = "メールアドレス、Apple、Google、LINE で会員カードを表示できます。",
  afterAuthUrl = "/member"
}: MemberAuthPanelProps) {
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailFlow, setEmailFlow] = useState<EmailFlow>("sign_in");
  const [codeSent, setCodeSent] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<OAuthStrategy | "">("");
  const [message, setMessage] = useState("");

  const authLoaded = signInLoaded && signUpLoaded && Boolean(signIn && signUp);
  const busy = emailBusy || Boolean(oauthBusy);
  const codeDigits = Array.from({ length: codeLength }, (_, index) => code[index] || "");

  function focusCodeInput(index: number) {
    codeInputRefs.current[index]?.focus();
    codeInputRefs.current[index]?.select();
  }

  function applyCodeValue(nextCode: string, focusIndex?: number) {
    const normalizedCode = nextCode.replace(/\D/g, "").slice(0, codeLength);
    setCode(normalizedCode);
    if (typeof focusIndex === "number") {
      window.requestAnimationFrame(() => focusCodeInput(Math.max(0, Math.min(codeLength - 1, focusIndex))));
    }
  }

  function handleCodeInput(index: number, value: string) {
    const digits = value.replace(/\D/g, "");
    if (!digits) {
      applyCodeValue(code.slice(0, index) + code.slice(index + 1), index);
      return;
    }
    const nextCode = `${code.slice(0, index)}${digits}${code.slice(index + digits.length)}`;
    applyCodeValue(nextCode, Math.min(index + digits.length, codeLength - 1));
  }

  function handleCodeKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !codeDigits[index] && index > 0) {
      event.preventDefault();
      applyCodeValue(code.slice(0, index - 1) + code.slice(index), index - 1);
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusCodeInput(index - 1);
    }
    if (event.key === "ArrowRight" && index < codeLength - 1) {
      event.preventDefault();
      focusCodeInput(index + 1);
    }
  }

  function handleCodePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pastedCode = event.clipboardData.getData("text");
    if (!pastedCode) return;
    event.preventDefault();
    applyCodeValue(pastedCode, codeLength - 1);
  }

  async function sendEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authLoaded) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage("メールアドレスを入力してください。");
      return;
    }

    setEmailBusy(true);
    setMessage("");
    let sent = false;
    try {
      const signInAttempt = await withAuthTimeout(signIn.create({ identifier: normalizedEmail }));
      const factor = emailCodeFactor(signInAttempt.supportedFirstFactors);
      if (!factor) {
        throw new Error("このメールアドレスでは確認コード認証を利用できません。Apple、Google、LINE でログインしてください。");
      }
      await withAuthTimeout(signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: factor.emailAddressId
      }));
      setEmailFlow("sign_in");
      sent = true;
    } catch (error) {
      if (error instanceof AuthTimeoutError) {
        setMessage(errorMessage(error));
      } else {
        try {
          await withAuthTimeout(signUp.create({ emailAddress: normalizedEmail }));
          await withAuthTimeout(signUp.prepareEmailAddressVerification({ strategy: "email_code" }));
          setEmailFlow("sign_up");
          sent = true;
        } catch (signUpError) {
          setMessage(errorMessage(signUpError) || errorMessage(error));
        }
      }
    }
    if (sent) {
      setCode("");
      setCodeSent(true);
      setMessage("確認コードをメールで送信しました。");
    }
    setEmailBusy(false);
  }

  async function verifyEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authLoaded) return;
    const verificationCode = code.trim();
    if (!verificationCode) {
      setMessage("確認コードを入力してください。");
      return;
    }

    setEmailBusy(true);
    setMessage("");
    try {
      if (emailFlow === "sign_in") {
        const signInAttempt = await withAuthTimeout(signIn.attemptFirstFactor({
          strategy: "email_code",
          code: verificationCode
        }));
        if (signInAttempt.status === "complete" && signInAttempt.createdSessionId) {
          await withAuthTimeout(setSignInActive({ session: signInAttempt.createdSessionId, redirectUrl: afterAuthUrl }));
          return;
        }
      } else {
        const signUpAttempt = await withAuthTimeout(signUp.attemptEmailAddressVerification({ code: verificationCode }));
        if (signUpAttempt.status === "complete" && signUpAttempt.createdSessionId) {
          await withAuthTimeout(setSignUpActive({ session: signUpAttempt.createdSessionId, redirectUrl: afterAuthUrl }));
          return;
        }
      }
      setMessage("認証を完了できませんでした。もう一度お試しください。");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setEmailBusy(false);
    }
  }

  async function startOAuth(strategy: OAuthStrategy) {
    if (!authLoaded) return;
    setOauthBusy(strategy);
    setMessage("");
    try {
      await withAuthTimeout(signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: absoluteAuthUrl("/sso-callback"),
        redirectUrlComplete: absoluteAuthUrl(afterAuthUrl),
        continueSignIn: true,
        continueSignUp: true
      }));
    } catch (error) {
      setOauthBusy("");
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
        <div id="clerk-captcha" className="member-auth-captcha" />

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
                disabled={emailBusy}
              />
            </label>
            <button className="primary-button" type="submit" disabled={emailBusy || !authLoaded}>
              {emailBusy ? <Loader2 size={16} /> : <Mail size={16} />}
              確認コードを送る
            </button>
          </form>
        ) : (
          <form className="member-auth-email-form" onSubmit={(event) => void verifyEmailCode(event)}>
            <div className="member-auth-code-field">
              <span>確認コード</span>
              <div className="member-auth-code-inputs" role="group" aria-label="確認コード">
                {codeDigits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(element) => {
                      codeInputRefs.current[index] = element;
                    }}
                    value={digit}
                    onChange={(event) => handleCodeInput(index, event.target.value)}
                    onKeyDown={(event) => handleCodeKeyDown(index, event)}
                    onPaste={handleCodePaste}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    aria-label={`確認コード ${index + 1} 桁目`}
                    disabled={emailBusy}
                    autoFocus={index === 0}
                  />
                ))}
              </div>
            </div>
            <button className="primary-button" type="submit" disabled={emailBusy || !authLoaded || code.length !== codeLength}>
              {emailBusy ? <Loader2 size={16} /> : <KeyRound size={16} />}
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
              disabled={emailBusy}
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
              disabled={emailBusy || Boolean(oauthBusy) || !authLoaded}
            >
              <span className="member-auth-provider-icon" aria-hidden="true">
                {oauthBusy === option.strategy ? <Loader2 size={17} /> : <ProviderIcon icon={option.icon} />}
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
