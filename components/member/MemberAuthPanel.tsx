"use client";

import { KeyRound, Loader2, LockKeyhole, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { normalizeIntegerInput } from "../../lib/number-input";
import { useMemberLanguage } from "./MemberLanguageProvider";

type MemberAuthPanelProps = {
  title?: string;
  description?: string;
  afterAuthUrl?: string;
};

type AuthStep = "login" | "email" | "verification";

const authCopy = {
  ja: {
    defaultTitle: "ログイン・会員登録",
    defaultDescription: "メールアドレスとパスワードでログインします。この端末ではログイン状態を1年間保持します。",
    email: "メールアドレス",
    password: "パスワード",
    passwordConfirm: "パスワード（確認）",
    login: "ログイン",
    firstTime: "初めて利用する・パスワードを忘れた",
    sendCode: "確認コードを送信",
    verificationCode: "確認コード",
    setPassword: "パスワードを設定してログイン",
    backToLogin: "ログインに戻る",
    sending: "送信中",
    processing: "処理中",
    emailRequired: "メールアドレスを入力してください。",
    passwordRequired: "パスワードを入力してください。",
    passwordRule: "8文字以上で、英字と数字を含めてください。",
    passwordMismatch: "確認用パスワードが一致しません。",
    codeRequired: "6桁の確認コードを入力してください。",
    codeSent: "確認コードをメールで送信しました。新しいパスワードを設定してください。",
    invalidCredentials: "メールアドレスまたはパスワードが正しくありません。",
    invalidCode: "確認コードが正しくないか、有効期限が切れています。",
    rateLimited: "試行回数が多すぎます。15分後にもう一度お試しください。",
    emailFailed: "確認メールを送信できませんでした。しばらくしてからお試しください。",
    genericError: "認証に失敗しました。しばらくしてからもう一度お試しください。",
    legal: "続行すると、利用規約とプライバシーポリシーに同意したものとみなされます。"
  },
  zh: {
    defaultTitle: "登录・注册会员", defaultDescription: "使用邮箱和密码登录。本设备将保持登录状态一年。", email: "邮箱地址", password: "密码", passwordConfirm: "确认密码", login: "登录", firstTime: "首次使用・忘记密码", sendCode: "发送验证码", verificationCode: "验证码", setPassword: "设置密码并登录", backToLogin: "返回登录", sending: "发送中", processing: "处理中", emailRequired: "请输入邮箱地址。", passwordRequired: "请输入密码。", passwordRule: "密码至少8位，并包含字母和数字。", passwordMismatch: "两次输入的密码不一致。", codeRequired: "请输入6位验证码。", codeSent: "验证码已发送，请设置新密码。", invalidCredentials: "邮箱或密码不正确。", invalidCode: "验证码不正确或已过期。", rateLimited: "尝试次数过多，请15分钟后再试。", emailFailed: "无法发送验证邮件，请稍后重试。", genericError: "认证失败，请稍后重试。", legal: "继续即表示同意使用条款和隐私政策。"
  },
  "zh-Hant": {
    defaultTitle: "登入・註冊會員", defaultDescription: "使用電子郵件和密碼登入。本裝置將保持登入狀態一年。", email: "電子郵件", password: "密碼", passwordConfirm: "確認密碼", login: "登入", firstTime: "首次使用・忘記密碼", sendCode: "傳送驗證碼", verificationCode: "驗證碼", setPassword: "設定密碼並登入", backToLogin: "返回登入", sending: "傳送中", processing: "處理中", emailRequired: "請輸入電子郵件。", passwordRequired: "請輸入密碼。", passwordRule: "密碼至少8位，並包含英文字母和數字。", passwordMismatch: "兩次輸入的密碼不一致。", codeRequired: "請輸入6位驗證碼。", codeSent: "驗證碼已傳送，請設定新密碼。", invalidCredentials: "電子郵件或密碼不正確。", invalidCode: "驗證碼不正確或已過期。", rateLimited: "嘗試次數過多，請15分鐘後再試。", emailFailed: "無法傳送驗證郵件，請稍後再試。", genericError: "認證失敗，請稍後重試。", legal: "繼續即表示同意使用條款和隱私權政策。"
  },
  en: {
    defaultTitle: "Sign in or register", defaultDescription: "Sign in with your email and password. This device stays signed in for one year.", email: "Email address", password: "Password", passwordConfirm: "Confirm password", login: "Sign in", firstTime: "First time or forgot password", sendCode: "Send verification code", verificationCode: "Verification code", setPassword: "Set password and sign in", backToLogin: "Back to sign in", sending: "Sending", processing: "Processing", emailRequired: "Enter your email address.", passwordRequired: "Enter your password.", passwordRule: "Use at least 8 characters with letters and numbers.", passwordMismatch: "Passwords do not match.", codeRequired: "Enter the 6-digit verification code.", codeSent: "We sent a verification code. Set your new password.", invalidCredentials: "The email address or password is incorrect.", invalidCode: "The verification code is incorrect or has expired.", rateLimited: "Too many attempts. Try again in 15 minutes.", emailFailed: "We could not send the verification email. Try again later.", genericError: "Authentication failed. Please try again later.", legal: "By continuing, you agree to the Terms and Privacy Policy."
  },
  ko: {
    defaultTitle: "로그인・회원 등록", defaultDescription: "이메일과 비밀번호로 로그인합니다. 이 기기에서는 1년간 로그인이 유지됩니다.", email: "이메일 주소", password: "비밀번호", passwordConfirm: "비밀번호 확인", login: "로그인", firstTime: "처음 이용・비밀번호 찾기", sendCode: "인증 코드 보내기", verificationCode: "인증 코드", setPassword: "비밀번호 설정 후 로그인", backToLogin: "로그인으로 돌아가기", sending: "전송 중", processing: "처리 중", emailRequired: "이메일 주소를 입력하세요.", passwordRequired: "비밀번호를 입력하세요.", passwordRule: "8자 이상, 영문과 숫자를 포함하세요.", passwordMismatch: "비밀번호가 일치하지 않습니다.", codeRequired: "6자리 인증 코드를 입력하세요.", codeSent: "인증 코드를 보냈습니다. 새 비밀번호를 설정하세요.", invalidCredentials: "이메일 주소 또는 비밀번호가 올바르지 않습니다.", invalidCode: "인증 코드가 올바르지 않거나 만료되었습니다.", rateLimited: "시도 횟수가 너무 많습니다. 15분 후 다시 시도하세요.", emailFailed: "인증 메일을 보낼 수 없습니다. 잠시 후 다시 시도하세요.", genericError: "인증에 실패했습니다. 잠시 후 다시 시도하세요.", legal: "계속하면 이용약관 및 개인정보 처리방침에 동의하는 것으로 간주됩니다."
  },
  vi: {
    defaultTitle: "Đăng nhập・Đăng ký", defaultDescription: "Đăng nhập bằng email và mật khẩu. Thiết bị này sẽ duy trì đăng nhập trong một năm.", email: "Địa chỉ email", password: "Mật khẩu", passwordConfirm: "Xác nhận mật khẩu", login: "Đăng nhập", firstTime: "Lần đầu sử dụng・Quên mật khẩu", sendCode: "Gửi mã xác thực", verificationCode: "Mã xác thực", setPassword: "Đặt mật khẩu và đăng nhập", backToLogin: "Quay lại đăng nhập", sending: "Đang gửi", processing: "Đang xử lý", emailRequired: "Vui lòng nhập email.", passwordRequired: "Vui lòng nhập mật khẩu.", passwordRule: "Dùng ít nhất 8 ký tự, gồm chữ và số.", passwordMismatch: "Mật khẩu không khớp.", codeRequired: "Nhập mã xác thực 6 chữ số.", codeSent: "Đã gửi mã xác thực. Hãy đặt mật khẩu mới.", invalidCredentials: "Email hoặc mật khẩu không đúng.", invalidCode: "Mã xác thực không đúng hoặc đã hết hạn.", rateLimited: "Quá nhiều lần thử. Vui lòng thử lại sau 15 phút.", emailFailed: "Không thể gửi email xác thực. Vui lòng thử lại sau.", genericError: "Xác thực thất bại. Vui lòng thử lại sau.", legal: "Khi tiếp tục, bạn đồng ý với Điều khoản và Chính sách quyền riêng tư."
  },
  ne: {
    defaultTitle: "लगइन・सदस्य दर्ता", defaultDescription: "इमेल र पासवर्डबाट लगइन गर्नुहोस्। यस उपकरणमा एक वर्षसम्म लगइन कायम रहनेछ।", email: "इमेल ठेगाना", password: "पासवर्ड", passwordConfirm: "पासवर्ड पुष्टि", login: "लगइन", firstTime: "पहिलो प्रयोग・पासवर्ड बिर्सिएँ", sendCode: "पुष्टि कोड पठाउनुहोस्", verificationCode: "पुष्टि कोड", setPassword: "पासवर्ड सेट गरी लगइन", backToLogin: "लगइनमा फर्कनुहोस्", sending: "पठाउँदै", processing: "प्रक्रिया हुँदै", emailRequired: "इमेल ठेगाना लेख्नुहोस्।", passwordRequired: "पासवर्ड लेख्नुहोस्।", passwordRule: "कम्तीमा ८ अक्षर, अक्षर र अंक समावेश गर्नुहोस्।", passwordMismatch: "पासवर्ड मिलेन।", codeRequired: "६ अङ्कको पुष्टि कोड लेख्नुहोस्।", codeSent: "पुष्टि कोड पठाइयो। नयाँ पासवर्ड सेट गर्नुहोस्।", invalidCredentials: "इमेल वा पासवर्ड गलत छ।", invalidCode: "पुष्टि कोड गलत छ वा म्याद सकिएको छ।", rateLimited: "धेरै प्रयास भयो। १५ मिनेटपछि फेरि प्रयास गर्नुहोस्।", emailFailed: "पुष्टि इमेल पठाउन सकिएन। पछि फेरि प्रयास गर्नुहोस्।", genericError: "प्रमाणीकरण असफल भयो। पछि फेरि प्रयास गर्नुहोस्।", legal: "जारी राख्दा प्रयोगका सर्त र गोपनीयता नीतिमा सहमत हुनुहुन्छ।"
  }
} as const;

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
    const params = new URLSearchParams({ completeProfile: "1" });
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
  const text = authCopy[language];
  const [step, setStep] = useState<AuthStep>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function localizedAuthError(code?: string) {
    if (code === "invalid_credentials") return text.invalidCredentials;
    if (code === "invalid_code" || code === "challenge_expired" || code === "challenge_consumed") return text.invalidCode;
    if (code === "rate_limited") return text.rateLimited;
    if (code === "email_failed") return text.emailFailed;
    if (code === "invalid_email") return text.emailRequired;
    if (code === "weak_password") return text.passwordRule;
    return text.genericError;
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return setMessage(text.emailRequired);
    if (!password) return setMessage(text.passwordRequired);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const body = await response.json().catch(() => ({})) as { code?: string };
      if (!response.ok) throw new Error(localizedAuthError(body.code));
      window.location.href = memberEntryUrl(afterAuthUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.genericError);
      setBusy(false);
    }
  }

  async function sendVerificationCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return setMessage(text.emailRequired);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/auth/verification/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
      });
      const body = await response.json().catch(() => ({})) as { challengeId?: string; code?: string };
      if (!response.ok || !body.challengeId) throw new Error(localizedAuthError(body.code));
      setChallengeId(body.challengeId);
      setStep("verification");
      setMessage(text.codeSent);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function completeVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 6) return setMessage(text.codeRequired);
    if (!password) return setMessage(text.passwordRequired);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return setMessage(text.passwordRule);
    if (password !== passwordConfirm) return setMessage(text.passwordMismatch);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/auth/verification/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, email: email.trim(), code, password })
      });
      const body = await response.json().catch(() => ({})) as { code?: string; needsProfile?: boolean };
      if (!response.ok) throw new Error(localizedAuthError(body.code));
      window.location.href = body.needsProfile
        ? memberSettingsCompletionUrl(afterAuthUrl)
        : memberEntryUrl(afterAuthUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.genericError);
      setBusy(false);
    }
  }

  return (
    <section className="member-auth-panel">
      <div className="member-auth-card">
        <div className="member-auth-heading">
          <span><KeyRound size={20} /></span>
          <div>
            <p className="eyebrow">Foundr1 Member</p>
            <h2>{title ?? text.defaultTitle}</h2>
            <p>{description ?? text.defaultDescription}</p>
          </div>
        </div>

        {step === "login" ? (
          <form className="member-auth-email-form" onSubmit={(event) => void submitLogin(event)}>
            <label>
              <span>{text.email}</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" disabled={busy} />
            </label>
            <label>
              <span>{text.password}</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" disabled={busy} />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? <Loader2 size={16} /> : <LockKeyhole size={16} />}
              {busy ? text.processing : text.login}
            </button>
            <button className="login-text-button" type="button" disabled={busy} onClick={() => {
              setStep("email");
              setPassword("");
              setMessage("");
            }}>
              {text.firstTime}
            </button>
          </form>
        ) : null}

        {step === "email" ? (
          <form className="member-auth-email-form" onSubmit={(event) => void sendVerificationCode(event)}>
            <label>
              <span>{text.email}</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" disabled={busy} />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? <Loader2 size={16} /> : <Mail size={16} />}
              {busy ? text.sending : text.sendCode}
            </button>
            <button className="login-text-button" type="button" disabled={busy} onClick={() => {
              setStep("login");
              setMessage("");
            }}>
              {text.backToLogin}
            </button>
          </form>
        ) : null}

        {step === "verification" ? (
          <form className="member-auth-email-form" onSubmit={(event) => void completeVerification(event)}>
            <label>
              <span>{text.verificationCode}</span>
              <input
                value={code}
                onChange={(event) => setCode(normalizeIntegerInput(event.target.value).slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                disabled={busy}
              />
            </label>
            <label>
              <span>{text.password}</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" disabled={busy} />
              <small>{text.passwordRule}</small>
            </label>
            <label>
              <span>{text.passwordConfirm}</span>
              <input value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} type="password" autoComplete="new-password" disabled={busy} />
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? <Loader2 size={16} /> : <KeyRound size={16} />}
              {busy ? text.processing : text.setPassword}
            </button>
            <button className="login-text-button" type="button" disabled={busy} onClick={() => {
              setStep("email");
              setCode("");
              setPassword("");
              setPasswordConfirm("");
              setMessage("");
            }}>
              {text.sendCode}
            </button>
          </form>
        ) : null}

        {message ? <div className="login-notice" role="status">{message}</div> : null}
        <p className="member-auth-legal-note">
          {text.legal} <a href="/member/terms" target="_blank" rel="noreferrer">Terms</a> · <a href="/privacy" target="_blank" rel="noreferrer">Privacy</a>
        </p>
      </div>
    </section>
  );
}
