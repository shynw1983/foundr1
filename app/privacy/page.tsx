const privacySections = [
  {
    title: "1. 取得する情報",
    body: "当社は、会員登録、注文、領収書表示、お問い合わせなどに必要な範囲で、氏名、メールアドレス、電話番号、注文履歴、ポイント・クーポン利用履歴、店舗利用情報などを取得することがあります。"
  },
  {
    title: "2. 利用目的",
    body: "取得した情報は、本人確認、会員カードの表示、注文管理、ポイント・クーポン管理、購入履歴・領収書の提供、お問い合わせ対応、サービス改善、不正利用の防止のために利用します。"
  },
  {
    title: "3. 第三者提供",
    body: "当社は、法令に基づく場合を除き、本人の同意なく個人情報を第三者へ提供しません。決済、認証、メール配信など、サービス提供に必要な範囲で外部サービスを利用することがあります。"
  },
  {
    title: "4. 安全管理",
    body: "当社は、個人情報の漏えい、滅失、き損、不正アクセスを防止するため、必要かつ適切な安全管理措置を講じます。"
  },
  {
    title: "5. 開示・訂正・利用停止",
    body: "本人から個人情報の開示、訂正、利用停止などの請求があった場合、法令に従い適切に対応します。"
  },
  {
    title: "6. Cookie 等の利用",
    body: "当社サービスでは、ログイン状態の維持、利便性向上、利用状況の把握のため Cookie などの技術を利用することがあります。"
  },
  {
    title: "7. 改定",
    body: "当社は、必要に応じて本ポリシーを改定することがあります。重要な変更がある場合は、適切な方法でお知らせします。"
  }
];

export default function PrivacyPage() {
  return (
    <main className="member-portal-page member-legal-page">
      <header className="member-portal-topbar">
        <a className="member-portal-brand" href="/member" aria-label="Foundr1 Members">
          <span><img src="/icons/foundr1-member-512.png" alt="Foundr1" /></span>
          <strong>Members</strong>
        </a>
      </header>

      <article className="member-legal-document">
        <p className="eyebrow">Privacy</p>
        <h1>プライバシーポリシー</h1>
        <p className="member-legal-lead">
          Foundr1 は、お客様の個人情報を、会員サービスと注文サービスを適切に提供するために必要な範囲で取り扱います。
        </p>
        <div className="member-legal-sections">
          {privacySections.map((section) => (
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
