import { sql } from "./db";
import type { EmployeeSession } from "./auth";

export type PrivacyDocumentSummary = {
  documentId: string;
  companyId: string;
  companyName: string;
  companyLegalName: string;
  companyAddress: string;
  companyRepresentativeName: string;
  privacyContactName: string;
  privacyContactEmail: string;
  privacyContactPhone: string;
  version: string;
  title: string;
  body: string;
  effectiveDate: string;
  storeNames: string[];
};

type CompanyRow = {
  companyId: string;
  companyName: string;
  companyLegalName: string | null;
  companyAddress: string | null;
  companyRepresentativeName: string | null;
  privacyContactName: string | null;
  privacyContactEmail: string | null;
  privacyContactPhone: string | null;
  storeNames: string[] | null;
};

type DocumentRow = {
  documentId: string;
  companyId: string;
  version: string;
  title: string;
  body: string;
  effectiveDate: string;
};

const allCompanyRoles = new Set(["owner", "manager"]);
const excludedConsentRoles = new Set(["store_terminal"]);
const defaultPrivacyDocumentVersion = "v1.0";
const defaultPrivacyDocumentTitle = "個人情報および個人番号の取扱いに関する通知書・同意書";

function clean(value?: string | null) {
  return String(value ?? "").trim();
}

function getClientIp(request?: Request) {
  return request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request?.headers.get("x-real-ip")
    || null;
}

function formatCompanyLine(label: string, value: string) {
  return `${label}：${value || "未設定"}`;
}

export function buildPrivacyDocumentBody(company: {
  companyLegalName: string;
  companyAddress: string;
  companyRepresentativeName: string;
  privacyContactName: string;
  privacyContactEmail: string;
  privacyContactPhone: string;
  storeNames?: string[];
}) {
  const companyName = company.companyLegalName || "［会社名］";
  const stores = company.storeNames?.length ? company.storeNames.join("、") : "所属・勤務予定店舗";
  const contactLines = [
    formatCompanyLine("会社名", companyName),
    formatCompanyLine("担当部署・担当者", company.privacyContactName),
    formatCompanyLine("メール", company.privacyContactEmail),
    formatCompanyLine("電話番号", company.privacyContactPhone)
  ].join("\n");

  return `個人情報および個人番号の取扱いに関する通知書・同意書

${formatCompanyLine("会社名", companyName)}
${formatCompanyLine("所在地", company.companyAddress)}
${formatCompanyLine("代表者", company.companyRepresentativeName)}
対象店舗：${stores}

${companyName}（以下「当社」といいます。）は、当社に雇用され、または当社の業務に従事する方（以下「従業員等」といいます。）の個人情報および個人番号（マイナンバー）を、以下のとおり取り扱います。

1. 取得する個人情報

当社は、必要な範囲で以下の情報を取得します。

(1) 氏名、住所、生年月日、電話番号、メールアドレス、緊急連絡先
(2) 採用、雇用契約、所属店舗、職位、勤務条件、評価、異動、退職に関する情報
(3) 勤怠、シフト、休暇、打刻時刻、打刻場所、業務記録に関する情報
(4) 給与、賞与、交通費、振込口座、税務・社会保険手続に必要な情報
(5) 業務システムの利用履歴、ログイン履歴、操作履歴、権限情報
(6) 店舗運営、安全管理、不正防止、労務管理上必要な情報
(7) その他、当社が雇用管理および業務運営のために必要と判断し、本人に明示した情報

2. GPS位置情報の取得

当社は、勤怠打刻、勤務場所の確認、不正打刻の防止、店舗運営上の安全管理を目的として、打刻時または業務上必要な操作時に、GPS等による位置情報を取得する場合があります。

位置情報は、原則として打刻時または業務上必要な操作時に限り取得し、勤務時間外に継続的な追跡を行う目的では利用しません。

3. 個人情報の利用目的

当社は、取得した個人情報を以下の目的で利用します。

(1) 採用選考、本人確認、雇用契約の締結・更新・終了
(2) 勤怠管理、シフト管理、給与計算、交通費精算
(3) 税務、社会保険、労働保険、福利厚生その他法令上必要な手続
(4) 店舗運営、人員配置、教育、研修、評価、業務連絡
(5) 業務システムのアカウント管理、権限管理、セキュリティ管理
(6) 労務トラブル、不正行為、事故、災害、緊急時対応への対応
(7) 法令、行政機関、裁判所その他公的機関からの要請への対応
(8) 当社の業務改善、内部管理、監査、記録保全

4. 個人情報の第三者提供・委託

当社は、法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。

ただし、以下の場合には、必要な範囲で個人情報を提供または委託することがあります。

(1) 税理士、社会保険労務士、弁護士等の専門家への提供
(2) 給与計算、勤怠管理、クラウドシステム、決済・会計・人事労務サービス事業者への委託
(3) 金融機関、行政機関、社会保険関係機関への手続上必要な提供
(4) 事業承継、組織再編、店舗運営委託等に伴い必要となる提供

当社は、委託先に対して必要かつ適切な監督を行います。

5. 個人番号（マイナンバー）の取得・利用目的

当社は、法令に基づく税務、社会保険、労働保険その他必要な行政手続のため、従業員等および扶養親族の個人番号（マイナンバー）の提供を依頼する場合があります。

当社は、取得した個人番号を以下の目的に限り利用します。

(1) 源泉徴収票、給与支払報告書その他税務関係書類の作成・提出
(2) 雇用保険、健康保険、厚生年金保険その他社会保険関係書類の作成・提出
(3) 労働保険その他法令に基づく行政手続
(4) 上記に関連して法令上必要となる事務

6. 個人番号の利用制限・提供先

当社は、個人番号を前条の利用目的以外には利用しません。個人番号を、勤怠管理、GPS打刻、人事評価、社内ID、システムログイン、店舗運営上の本人識別その他の一般的な従業員管理目的には利用しません。

当社は、法令に基づき必要な場合、税務署、市区町村、年金事務所、健康保険組合、ハローワークその他行政機関等に、個人番号を記載した書類を提出することがあります。

また、税理士、社会保険労務士、給与計算業務の委託先等に、必要な範囲で個人番号関連事務を委託する場合があります。

7. 安全管理措置

当社は、個人情報および個人番号の漏えい、滅失、毀損、不正アクセス、不正利用を防止するため、アクセス権限の管理、操作履歴の記録、従業員教育、委託先管理、保管・廃棄ルールの整備その他必要かつ適切な安全管理措置を講じます。

特に、個人番号および特定個人情報については、取扱担当者を限定し、一般の従業員情報とは区別して管理します。

8. 保存期間および廃棄

当社は、利用目的の達成に必要な期間または法令上必要な保存期間に限り、個人情報および個人番号を保存します。

保存期間経過後または保管の必要がなくなった場合は、適切な方法により削除または廃棄します。個人番号については、復元できない方法により速やかに削除または廃棄します。

9. 開示・訂正・利用停止等

本人は、当社が保有する自己の個人情報について、法令に基づき、開示、訂正、追加、削除、利用停止、第三者提供停止等を請求することができます。

ただし、個人番号については、法令に基づく保存義務その他正当な理由がある場合、直ちに削除できないことがあります。

10. 問い合わせ窓口

個人情報および個人番号の取扱いに関する問い合わせは、以下の窓口までご連絡ください。

${contactLines}

11. 同意確認

私は、上記内容について説明を受け、当社による個人情報および個人番号の取得、利用、保管、委託、必要な提供ならびに保存期間経過後の削除・廃棄について確認し、同意します。`;
}

async function ensureActivePrivacyDocuments(companyIds: string[]) {
  if (!companyIds.length) return;

  await sql`
    insert into privacy_documents (company_id, version, title, body)
    select companies.id, ${defaultPrivacyDocumentVersion}, ${defaultPrivacyDocumentTitle}, ''
    from companies
    where companies.id::text = any(${companyIds})
      and not exists (
        select 1
        from privacy_documents
        where privacy_documents.company_id = companies.id
          and privacy_documents.is_active = true
      )
    on conflict do nothing
  `;
}

export async function getEmployeeConsentCompanies(session: EmployeeSession): Promise<CompanyRow[]> {
  if (excludedConsentRoles.has(session.role)) return [];

  const assignedRows = await sql`
    select
      companies.id::text as "companyId",
      companies.name as "companyName",
      companies.legal_name as "companyLegalName",
      companies.address as "companyAddress",
      companies.representative_name as "companyRepresentativeName",
      companies.privacy_contact_name as "privacyContactName",
      companies.privacy_contact_email as "privacyContactEmail",
      companies.privacy_contact_phone as "privacyContactPhone",
      array_remove(array_agg(distinct stores.name order by stores.name), null) as "storeNames"
    from companies
    join stores on stores.company_id = companies.id
    where companies.status = 'active'
      and stores.status = 'active'
      and (
        exists (
          select 1
          from employee_work_stores
          where employee_work_stores.employee_id = ${session.id}
            and employee_work_stores.store_id = stores.id
            and employee_work_stores.resignation_date is null
        )
        or exists (
          select 1
          from employee_scopes
          where employee_scopes.employee_id = ${session.id}
            and employee_scopes.scope_type = 'store'
            and employee_scopes.store_id = stores.id
        )
      )
    group by companies.id
    order by coalesce(companies.legal_name, companies.name)
  ` as CompanyRow[];

  if (assignedRows.length || !allCompanyRoles.has(session.role)) return assignedRows;

  return await sql`
    select
      companies.id::text as "companyId",
      companies.name as "companyName",
      companies.legal_name as "companyLegalName",
      companies.address as "companyAddress",
      companies.representative_name as "companyRepresentativeName",
      companies.privacy_contact_name as "privacyContactName",
      companies.privacy_contact_email as "privacyContactEmail",
      companies.privacy_contact_phone as "privacyContactPhone",
      array_remove(array_agg(distinct stores.name order by stores.name), null) as "storeNames"
    from companies
    left join stores on stores.company_id = companies.id and stores.status = 'active'
    where companies.status = 'active'
    group by companies.id
    order by coalesce(companies.legal_name, companies.name)
  ` as CompanyRow[];
}

export async function getPendingPrivacyConsents(session: EmployeeSession): Promise<PrivacyDocumentSummary[]> {
  const companies = await getEmployeeConsentCompanies(session);
  const companyIds = companies.map((company) => company.companyId);
  await ensureActivePrivacyDocuments(companyIds);
  if (!companyIds.length) return [];

  const documentRows = await sql`
    select
      privacy_documents.id::text as "documentId",
      privacy_documents.company_id::text as "companyId",
      privacy_documents.version,
      privacy_documents.title,
      privacy_documents.body,
      privacy_documents.effective_date::text as "effectiveDate"
    from privacy_documents
    where privacy_documents.company_id::text = any(${companyIds})
      and privacy_documents.is_active = true
      and not exists (
        select 1
        from privacy_consents
        where privacy_consents.employee_id = ${session.id}
          and privacy_consents.company_id = privacy_documents.company_id
          and privacy_consents.document_id = privacy_documents.id
      )
    order by privacy_documents.effective_date, privacy_documents.created_at
  ` as DocumentRow[];

  const companyById = new Map(companies.map((company) => [company.companyId, company]));
  return documentRows.map((document) => {
    const company = companyById.get(document.companyId);
    const storeNames = (company?.storeNames ?? []).map(clean).filter(Boolean);
    const companyLegalName = clean(company?.companyLegalName) || clean(company?.companyName);
    const generatedBody = buildPrivacyDocumentBody({
      companyLegalName,
      companyAddress: clean(company?.companyAddress),
      companyRepresentativeName: clean(company?.companyRepresentativeName),
      privacyContactName: clean(company?.privacyContactName),
      privacyContactEmail: clean(company?.privacyContactEmail),
      privacyContactPhone: clean(company?.privacyContactPhone),
      storeNames
    });

    return {
      documentId: document.documentId,
      companyId: document.companyId,
      companyName: clean(company?.companyName),
      companyLegalName,
      companyAddress: clean(company?.companyAddress),
      companyRepresentativeName: clean(company?.companyRepresentativeName),
      privacyContactName: clean(company?.privacyContactName),
      privacyContactEmail: clean(company?.privacyContactEmail),
      privacyContactPhone: clean(company?.privacyContactPhone),
      version: document.version,
      title: document.title,
      body: clean(document.body) || generatedBody,
      effectiveDate: document.effectiveDate,
      storeNames
    };
  });
}

export async function hasPendingPrivacyConsents(session: EmployeeSession) {
  const pending = await getPendingPrivacyConsents(session);
  return pending.length > 0;
}

export async function recordPrivacyConsents(session: EmployeeSession, documentIds: string[], request?: Request) {
  const pending = await getPendingPrivacyConsents(session);
  const allowedDocumentIds = new Set(pending.map((document) => document.documentId));
  const selected = documentIds.filter((documentId) => allowedDocumentIds.has(documentId));
  if (selected.length !== pending.length) {
    throw new Error("未確認の会社文書が残っています。");
  }

  for (const document of pending) {
    await sql`
      insert into privacy_consents (
        employee_id,
        company_id,
        document_id,
        document_version,
        employee_name_snapshot,
        ip_address,
        user_agent
      )
      values (
        ${session.id},
        ${document.companyId},
        ${document.documentId},
        ${document.version},
        ${session.name},
        ${getClientIp(request)},
        ${request?.headers.get("user-agent") ?? null}
      )
      on conflict do nothing
    `;
  }

  return pending.length;
}
