import { setTimeout as delay } from 'node:timers/promises';

export const COMPETITOR_VERIFICATION_ERROR = 'competitor_security_verification_required';

export function competitorPageState({ title = '', text = '', menuLoaded = false, challenge = false } = {}) {
  if (challenge || /セキュリティ検証|Verify you are human|Checking your browser|確認してください.*人間/iu.test(`${title}\n${text}`)
    || /^(?:Just a moment|しばらくお待ちください)/iu.test(title)) return 'verification';
  if (!menuLoaded && /Enter delivery address|配達先(?:住所)?を入力/iu.test(text)) return 'address_required';
  if (!menuLoaded && /店が見つかりません|page not found|store not found/iu.test(text)) return 'store_not_found';
  return menuLoaded ? 'ready' : 'loading';
}

export async function waitForCompetitorMenu(page, { timeoutMs = 30000, wait = delay } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let snapshot;
    try { snapshot = await page.evaluate(`({
      title: document.title,
      challenge: Boolean(document.querySelector('#challenge-running, #challenge-form, iframe[src*="challenges.cloudflare.com"]')),
      text: (document.body?.innerText || '').slice(0, 4000),
      menuLoaded: Boolean(document.querySelector('h1') && document.querySelector('a[href*="mod=quickView"]'))
    })`); } catch (error) {
      if (!/Execution context was destroyed|Cannot find context with specified id/i.test(error.message)) throw error;
      await wait(250);
      continue;
    }
    const state = competitorPageState(snapshot);
    if (state === 'verification') throw new Error(`${COMPETITOR_VERIFICATION_ERROR}: 競合調査専用の Chrome 画面で安全確認を完了してから再試行してください。商家用ブラウザとは別です。`);
    if (state === 'address_required' || state === 'store_not_found') throw new Error(`competitor_${state}`);
    if (state === 'ready') return;
    await wait(250);
  }
  throw new Error('competitor_menu_load_timeout');
}
