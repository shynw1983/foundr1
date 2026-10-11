"use client";

import { useState, type FormEvent } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import type { useStoreInventoryOperator } from "./useStoreInventoryOperator";
import styles from "./StoreInventoryExecution.module.css";

export function StoreInventoryOperatorPanel({ context }: { context: ReturnType<typeof useStoreInventoryOperator> }) {
  const { t, language } = useOsTranslation();
  const [loginId, setLoginId] = useState(""), [password, setPassword] = useState("");
  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (context.busy) return;
    const submittedPassword = password; setPassword("");
    await context.authorize(loginId.trim(), submittedPassword);
  }
  return <section className={styles.operator} data-store-inventory-operator data-i18n-ignore>
    <div className={styles.heading}><strong>{t("今回の操作担当者")}</strong><button type="button" className="text-button" disabled={context.loading || context.busy} onClick={() => void context.refresh()}>{t("再確認")}</button></div>
    {context.error ? <p role="alert" className={styles.error}>{t(context.error)}</p> : null}
    {context.canOperate && context.operator ? <div className={styles.heading}><p><strong>{context.operator.name}</strong>{context.operator.expiresAt ? <small> · {t("有効期限")} {new Date(context.operator.expiresAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}</small> : null}</p>{context.isTerminal ? <button type="button" className="secondary-button" disabled={context.busy} onClick={() => void context.clear()}>{t("担当者を交代")}</button> : null}</div> : <p className={styles.hint}>{t("在庫は閲覧できます。保存する前に、操作するスタッフ本人を確認してください。")}</p>}
    {!context.canOperate && context.requiresOperatorAuthentication && !context.loading ? <form className={styles.operatorForm} onSubmit={event => void authorize(event)}>
      <label>{t("スタッフのログインID")}<input name="operatorLoginId" autoComplete="username" value={loginId} disabled={context.busy} onChange={event => setLoginId(event.target.value)} required /></label>
      <label>{t("スタッフのパスワード")}<input name="operatorPassword" type="password" autoComplete="off" value={password} disabled={context.busy} onChange={event => setPassword(event.target.value)} required /></label>
      <button type="submit" className="primary-button" disabled={context.busy || !loginId.trim() || !password}>{t("本人を確認して操作")}</button>
    </form> : null}
  </section>;
}
