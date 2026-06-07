"use client";

import { MemberLanguageSwitcher, useMemberLanguage } from "../../../components/member/MemberLanguageProvider";
import { memberText } from "../../../components/member/memberTranslations";

const terms = [
  {
    title: "第1条（適用）",
    body: "本規約は、Foundr1 が提供する会員カード、ポイント、クーポン、購入履歴、領収書表示などの会員向けサービスの利用条件を定めるものです。"
  },
  {
    title: "第2条（会員登録）",
    body: "利用者は、メールアドレス認証その他当社が定める方法により会員登録を行うことができます。登録情報に変更があった場合、利用者は速やかに最新の内容へ更新するものとします。"
  },
  {
    title: "第3条（アカウント管理）",
    body: "利用者は、自身のアカウントを適切に管理するものとします。第三者による不正利用が疑われる場合は、速やかに当社へ連絡してください。"
  },
  {
    title: "第4条（ポイント・クーポン）",
    body: "ポイント、スタンプ、クーポンなどの特典は、当社が定める条件に従って付与・利用されます。返品、取消、システム上の誤りがある場合、当社は付与内容を修正または取り消すことがあります。"
  },
  {
    title: "第5条（購入履歴・領収書）",
    body: "会員は、対象となる注文について購入履歴や領収書を確認できます。注文の取消または返金が行われた場合、領収書は返金記録として表示されることがあります。"
  },
  {
    title: "第6条（禁止事項）",
    body: "利用者は、虚偽の登録、不正アクセス、特典の不正取得・転売、他の利用者や店舗運営を妨げる行為、法令または公序良俗に反する行為を行ってはなりません。"
  },
  {
    title: "第7条（サービスの変更・停止）",
    body: "当社は、運営上必要な場合、会員サービスの内容を変更、一時停止、または終了することがあります。"
  },
  {
    title: "第8条（個人情報）",
    body: "当社は、会員サービスの提供、本人確認、注文管理、特典管理、お問い合わせ対応のため、必要な範囲で個人情報を取り扱います。詳細はプライバシーポリシーをご確認ください。"
  },
  {
    title: "第9条（規約の変更）",
    body: "当社は、必要に応じて本規約を変更することがあります。重要な変更がある場合は、適切な方法でお知らせします。"
  },
  {
    title: "第10条（準拠法・管轄）",
    body: "本規約は日本法に準拠します。本サービスに関して紛争が生じた場合、当社所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。"
  }
];

export default function MemberTermsPage() {
  const { language } = useMemberLanguage();
  const text = memberText[language];

  return (
    <main className="member-portal-page member-legal-page">
      <header className="member-portal-topbar">
        <a className="member-portal-brand" href="/member" aria-label="Foundr1 Members">
          <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
          <strong>Members</strong>
        </a>
        <MemberLanguageSwitcher />
      </header>

      <article className="member-legal-document">
        <p className="eyebrow">{text.terms}</p>
        <h1>Foundr1 Member {text.terms}</h1>
        <p className="member-legal-lead">
          この規約は、Foundr1 の会員カードおよび会員向けサービスを安心してご利用いただくための基本的な条件をまとめたものです。
        </p>
        <div className="member-legal-sections">
          {terms.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
        <p className="member-legal-updated">制定日: 2026年6月7日</p>
      </article>
    </main>
  );
}
