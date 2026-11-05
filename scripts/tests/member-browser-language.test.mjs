import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('components/member/MemberLanguageProvider.tsx', 'utf8');
const code = ts.transpileModule(`${source}\nexport { browserLanguage, initialLanguage };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
function fixture(navigator, { search = '', stored = null } = {}) {
  const exports = {};
  runInNewContext(code, {
    exports, navigator, URLSearchParams,
    window: { location: { search }, localStorage: { getItem: () => stored } },
    require: name => {
      if (name === 'react') return { createContext: () => ({}) };
      if (name === 'react/jsx-runtime' || name === 'lucide-react') return {};
      throw Error(`Unexpected dependency: ${name}`);
    }
  });
  return exports;
}
for (const [languages, expected] of [
  [['ja-JP', 'zh-CN', 'en-US'], 'ja'],
  [['ja', 'zh-TW'], 'ja'],
  [['en-US', 'zh-CN', 'ja'], 'en'],
  [['zh-CN', 'zh-TW', 'ja'], 'zh'],
  [['zh-TW', 'zh-CN'], 'zh-Hant'],
  [['zh-Hant-HK', 'ja'], 'zh-Hant'],
  [['zh-HK', 'ja'], 'zh-Hant'],
  [['ko-KR', 'zh-CN'], 'ko'],
  [['vi-VN', 'en-US'], 'vi'],
  [['ne-NP', 'en-US'], 'ne'],
  [['fr-FR', 'en-GB', 'zh-CN'], 'en'],
  [['fr-FR', 'de-DE'], 'ja'],
  [[' JA-jp ', 'zh-CN'], 'ja']
]) {
  test(`browser preference ${languages.join(' > ')} selects ${expected}`, () => {
    const f = fixture({ language: languages[0], languages });
    assert.equal(f.browserLanguage(), expected);
    assert.equal(f.initialLanguage(), expected);
  });
}
test('ordered languages take precedence over a differing singular language', () => {
  assert.equal(fixture({ language: 'zh-CN', languages: ['ja-JP', 'zh-CN'] }).browserLanguage(), 'ja');
});
for (const languages of [undefined, []]) {
  test(`singular language fallback when languages is ${JSON.stringify(languages)}`, () => {
    assert.equal(fixture({ language: 'en-US', languages }).browserLanguage(), 'en');
  });
}
test('missing browser language defaults to Japanese', () => {
  assert.equal(fixture(undefined).browserLanguage(), 'ja');
});
test('explicit URL language precedes saved language and browser preference', () => {
  assert.equal(fixture({ language: 'ja-JP', languages: ['ja-JP'] }, { search: '?lang=ko', stored: 'zh' }).initialLanguage(), 'ko');
});
test('saved user language precedes browser preference', () => {
  assert.equal(fixture({ language: 'ja-JP', languages: ['ja-JP'] }, { stored: 'en' }).initialLanguage(), 'en');
});
test('invalid saved language falls through to browser preference', () => {
  assert.equal(fixture({ language: 'ja-JP', languages: ['ja-JP', 'zh-CN'] }, { stored: 'invalid' }).initialLanguage(), 'ja');
});
