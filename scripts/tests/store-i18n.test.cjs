const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/maamaa-production-rules.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, context);
const { translateMaamaaReferenceText: translate } = context.exports;
const dictionaries = Object.fromEntries(['zh', 'zh-Hans', 'zh-Hant'].map(language => [language, JSON.parse(fs.readFileSync(`public/locales/os/${language}.json`, 'utf8'))]));
test('reference translations preserve Japanese and unknown operational text', () => {
  assert.equal(translate('黒キクラゲ / 7個くらい', 'ja'), '黒キクラゲ / 7個くらい');
  assert.equal(translate('独自SKU-123 / 50g', 'zh'), '独自SKU-123 / 50g');
  assert.equal(translate(undefined, 'zh'), '');
});
test('reference quantities and compound instructions support both Chinese scripts', () => {
  assert.equal(translate('黒キクラゲ / 7個くらい', 'zh'), '黑木耳 / 约7个');
  const traditional = text => dictionaries['zh-Hant'][text] ?? text;
  assert.equal(translate('黒キクラゲ / 7個くらい', 'zh', traditional), '黑木耳 / 約7個');
  assert.equal(translate('豆腐 / 1パック', 'zh', traditional), '豆腐 / 1包');
  assert.equal(translate('1セット / 1ショット', 'zh', traditional), '1份 / 1份');
});
test('localized UI templates retain all interpolation tokens', () => {
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    for (const [source, translation] of Object.entries(dictionary)) {
      if (!/\{\w+\}/.test(source)) continue;
      assert.deepEqual([...translation.matchAll(/\{\w+\}/g)].map(m => m[0]).sort(), [...source.matchAll(/\{\w+\}/g)].map(m => m[0]).sort(), `${language}: ${source}`);
    }
  }
});
