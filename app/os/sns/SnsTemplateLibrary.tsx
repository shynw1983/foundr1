'use client';
import { useEffect, useState } from 'react';
import { snsQuery, snsRequest, type SnsTemplate } from '../../../lib/sns-client';
import { useOsTranslation } from '../components/OsTranslationProvider';
import './sns-library.css';
type Props = { storeId: string; surface: 'store' | 'os'; disabled: boolean; canSave: boolean; dirty: boolean; current: SnsTemplate | null; onLoad: (template: SnsTemplate) => Promise<void>; onSave: (name: string, update: boolean) => Promise<SnsTemplate>; onError: (error: unknown) => void };
export function SnsTemplateLibrary({ storeId, surface, disabled, canSave, dirty, current, onLoad, onSave, onError }: Props) {
    const { t } = useOsTranslation();
    const [templates, setTemplates] = useState<SnsTemplate[]>([]), [name, setName] = useState(''), [waiting, setWaiting] = useState(false), [failed, setFailed] = useState(false), [reload, setReload] = useState(0), [pending, setPending] = useState<SnsTemplate | null>(null), [nextCursor, setNextCursor] = useState<string | null>(null);
    useEffect(() => { setName(current?.name ?? ''); }, [current?.id, current?.name]);
    useEffect(() => {
        let alive = true;
        setWaiting(true); setFailed(false);
        snsRequest<{ templates: SnsTemplate[]; nextCursor: string | null }>(`/api/sns/templates?${snsQuery(storeId, surface)}`).then(data => { if (alive) { setTemplates(data.templates); setNextCursor(data.nextCursor); } }).catch(() => { if (alive) setFailed(true); }).finally(() => { if (alive) setWaiting(false); });
        return () => { alive = false; };
    }, [storeId, surface, reload]);
    async function loadMore() {
        if (!nextCursor) return;
        setWaiting(true);
        try {
            const data = await snsRequest<{ templates: SnsTemplate[]; nextCursor: string | null }>(`/api/sns/templates?${snsQuery(storeId, surface)}&cursor=${encodeURIComponent(nextCursor)}`);
            setTemplates(previous => [...previous, ...data.templates.filter(item => !previous.some(p => p.id === item.id))]); setNextCursor(data.nextCursor);
        } catch (error) { onError(error); } finally { setWaiting(false); }
    }
    async function open(template: SnsTemplate) {
        setPending(null); setWaiting(true);
        try { await onLoad(template); } catch (error) { onError(error); } finally { setWaiting(false); }
    }
    async function save(update: boolean) {
        if (!name.trim()) return;
        setWaiting(true);
        try { const saved = await onSave(name.trim(), update); setName(saved.name); setReload(x => x + 1); } catch (error) { onError(error); } finally { setWaiting(false); }
    }
    const locked = disabled || waiting;
    return <details className="sns-library" open data-testid="sns-template-library">
        <summary>{t('保存したテンプレート')}</summary>
        <p className="sns-text-hint">{t('写真・文字・書式・グループを店舗に保存し、あとから編集できます。')}</p>
        <label>{t('テンプレート名')}<input type="text" data-testid="sns-template-name" maxLength={80} value={name} disabled={locked} onChange={e => setName(e.target.value)} placeholder={t('例：週末のお知らせ')} /></label>
        <div className="sns-actions">
            {current?.canEdit && <button type="button" disabled={locked || !canSave || !name.trim()} onClick={() => void save(true)} data-testid="sns-template-update">{t('テンプレートを更新')}</button>}
            <button type="button" className="primary" disabled={locked || !canSave || !name.trim()} onClick={() => void save(false)} data-testid="sns-template-save">{t(current ? '別のテンプレートとして保存' : 'テンプレートを保存')}</button>
        </div>
        {current && <small data-testid="sns-template-current" data-id={current.id}>{t('編集中：{name}', { name: current.name })}{!current.canEdit && ` · ${t('変更内容は別名で保存できます。')}`}</small>}
        {failed ? <div role="alert"><p>{t('テンプレート一覧を読み込めません。')}</p><button type="button" onClick={() => setReload(x => x + 1)}>{t('再試行')}</button></div> : null}
        {waiting && <p role="status">{t('テンプレートを処理中…')}</p>}
        {!waiting && !failed && !templates.length && <p className="sns-text-hint">{t('保存したテンプレートはまだありません。')}</p>}
        <div className="sns-template-list">
            {templates.map(template => <button type="button" key={template.id} data-testid="sns-template-open" data-template-id={template.id} disabled={locked} onClick={() => { if (dirty) setPending(template); else void open(template); }}>
                {template.previewUrl && <img src={template.previewUrl} alt="" width={54} height={96} loading="lazy" />}
                <span data-i18n-ignore>{template.name}</span>
                <small>{t('開いて編集')}</small>
            </button>)}
        </div>
        {nextCursor && <button type="button" disabled={locked} onClick={() => void loadMore()}>{t("さらに表示")}</button>}
        {pending && <div className="sns-template-confirm" role="alertdialog" aria-label={t('編集中の内容を置き換えますか？')}>
            <p>{t('保存していない編集内容を、選択したテンプレートで置き換えます。')}</p>
            <div className="sns-actions"><button type="button" onClick={() => setPending(null)}>{t('編集を続ける')}</button><button type="button" onClick={() => void open(pending)}>{t('テンプレートを開く')}</button></div>
        </div>}
    </details>;
}
