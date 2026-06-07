"use client";

import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { ClipboardEvent, FormEvent, KeyboardEvent, useRef, useState } from "react";
import { useMemberLanguage } from "./MemberLanguageProvider";
import { memberText } from "./memberTranslations";

type MemberAuthPanelProps = {
  title?: string;
  description?: string;
  afterAuthUrl?: string;
};

type EmailFlow = "sign_in" | "sign_up";
type AuthStep = "email" | "preparing_code" | "code";
type EmailCodeFactorLike = { strategy: "email_code"; emailAddressId: string };
type SignUpCompletionResource = {
  status: string | null;
  missingFields?: string[];
  createdSessionId?: string | null;
};

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

function signUpCompletionMessage(signUpAttempt: SignUpCompletionResource, text: typeof memberText[keyof typeof memberText]) {
  const missingFields = signUpAttempt.missingFields || [];
  if (missingFields.includes("password")) {
    return text.authPasswordRequired;
  }
  if (missingFields.length) {
    return text.authMissingFields(missingFields.join(", "));
  }
  if (signUpAttempt.status) {
    return text.authStatusCannotComplete(signUpAttempt.status);
  }
  return text.authCannotComplete;
}

function memberEntryUrl(url: string) {
  try {
    const nextUrl = new URL(url, window.location.origin);
    nextUrl.searchParams.delete("completeProfile");
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  } catch {
    return "/member";
  }
}

function memberSettingsCompletionUrl(url: string) {
  try {
    const nextUrl = new URL(url, window.location.origin);
    const params = new URLSearchParams();
    params.set("completeProfile", "1");
    const returnTo = nextUrl.searchParams.get("returnTo");
    const handoff = nextUrl.searchParams.get("handoff");
    if (returnTo) params.set("returnTo", returnTo);
    if (handoff) params.set("handoff", handoff);
    return `/member/settings?${params.toString()}`;
  } catch {
    return "/member/settings?completeProfile=1";
  }
}

export function MemberAuthPanel({
  title,
  description,
  afterAuthUrl = "/member"
}: MemberAuthPanelProps) {
  const { language } = useMemberLanguage();
  const text = memberText[language];
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailFlow, setEmailFlow] = useState<EmailFlow>("sign_in");
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [emailBusy, setEmailBusy] = useState(false);
  const [message, setMessage] = useState("");

  const authLoaded = signInLoaded && signUpLoaded && Boolean(signIn && signUp);
  const codeDigits = Array.from({ length: codeLength }, (_, index) => code[index] || "");
  const codeReady = authStep === "code";
  const codePreparing = authStep === "preparing_code";

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
      setMessage(text.emailRequired);
      return;
    }

    setEmailBusy(true);
    setCode("");
    setAuthStep("preparing_code");
    setMessage("");
    let sent = false;
    try {
      const signInAttempt = await withAuthTimeout(signIn.create({ identifier: normalizedEmail }));
      const factor = emailCodeFactor(signInAttempt.supportedFirstFactors);
      if (!factor) {
        throw new Error(text.authUnavailableEmail);
      }
      await withAuthTimeout(signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: factor.emailAddressId
      }));
      setEmailFlow("sign_in");
      sent = true;
    } catch (error) {
      if (error instanceof AuthTimeoutError) {
        setMessage(text.authNoResponse);
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
      setAuthStep("code");
      setMessage(text.codeSent);
      window.requestAnimationFrame(() => focusCodeInput(0));
    } else {
      setAuthStep("email");
    }
    setEmailBusy(false);
  }

  async function verifyEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authLoaded) return;
    const verificationCode = code.trim();
    if (!verificationCode) {
      setMessage(text.codeRequired);
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
          await withAuthTimeout(setSignInActive({ session: signInAttempt.createdSessionId, redirectUrl: memberEntryUrl(afterAuthUrl) }));
          return;
        }
      } else {
        let signUpAttempt = await withAuthTimeout(signUp.attemptEmailAddressVerification({ code: verificationCode }));
        if (signUpAttempt.status === "missing_requirements") {
          const missingFields = signUpAttempt.missingFields || [];
          const canAutoComplete = missingFields.every((field) => field === "first_name" || field === "last_name" || field === "legal_accepted");
          if (canAutoComplete) {
            signUpAttempt = await withAuthTimeout(signUp.update({
              firstName: missingFields.includes("first_name") ? "Foundr1" : undefined,
              lastName: missingFields.includes("last_name") ? "Member" : undefined,
              legalAccepted: missingFields.includes("legal_accepted") ? true : undefined
            }));
          }
        }
        if (signUpAttempt.status === "complete" && signUpAttempt.createdSessionId) {
          await withAuthTimeout(setSignUpActive({ session: signUpAttempt.createdSessionId, redirectUrl: memberSettingsCompletionUrl(afterAuthUrl) }));
          return;
        }
        setMessage(signUpCompletionMessage(signUpAttempt, text));
        return;
      }
      setMessage(text.authCannotComplete);
    } catch (error) {
      setMessage(error instanceof AuthTimeoutError ? text.authNoResponse : errorMessage(error));
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <section className="member-auth-panel">
      <div className="member-auth-card">
        <div className="member-auth-heading">
          <span><KeyRound size={20} /></span>
          <div>
            <p className="eyebrow">{text.authEyebrow}</p>
            <h2>{title ?? text.loginOrRegister}</h2>
            <p>{description ?? text.loginDescription}</p>
          </div>
        </div>
        <div id="clerk-captcha" className="member-auth-captcha" />

        {authStep === "email" ? (
          <form className="member-auth-email-form" onSubmit={(event) => void sendEmailCode(event)}>
            <label>
              <span>{text.email}</span>
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
              {text.sendCode}
            </button>
            <p className="member-auth-legal-note">
              {text.legalPrefix}
              <a href="/member/terms" target="_blank" rel="noreferrer">{text.terms}</a>
              ・
              <a href="/privacy" target="_blank" rel="noreferrer">{text.privacy}</a>
              {text.legalSuffix}
            </p>
          </form>
        ) : (
          <form className="member-auth-email-form" onSubmit={(event) => void verifyEmailCode(event)}>
            <div className="member-auth-code-field">
              <span>{text.verificationCode}</span>
              {codePreparing ? <small>{text.sendingCode}</small> : null}
              <div className="member-auth-code-inputs" role="group" aria-label={text.verificationCode}>
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
                    aria-label={text.codeDigit(index + 1)}
                    disabled={emailBusy || !codeReady}
                    autoFocus={index === 0 && codeReady}
                  />
                ))}
              </div>
            </div>
            <button className="primary-button" type="submit" disabled={emailBusy || !authLoaded || !codeReady || code.length !== codeLength}>
              {emailBusy ? <Loader2 size={16} /> : <KeyRound size={16} />}
              {codePreparing ? text.sendingCode : text.showMemberCard}
            </button>
            <button
              className="member-auth-link-button"
              type="button"
              onClick={() => {
                setCode("");
                setAuthStep("email");
                setMessage("");
              }}
              disabled={emailBusy}
            >
              {text.changeEmail}
            </button>
          </form>
        )}

        {message ? <p className="member-auth-message">{message}</p> : null}
      </div>
    </section>
  );
}
