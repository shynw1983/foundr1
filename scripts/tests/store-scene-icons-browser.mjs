// Requires the isolated store-scene-icons-ui.cjs server. Only local fake data is changed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cli = process.env.AGENT_BROWSER_BIN || 'agent-browser';
const output = resolve(process.env.SCENE_ICONS_OUTPUT || 'outputs/store-scene-icons-20261001');
mkdirSync(output, { recursive: true });
const args = ['--session', 'store-scene-icons-20261001'];
const command = (...operation) => {
  const result = JSON.parse(execFileSync(cli, [...args, ...operation, '--json'], { encoding: 'utf8', timeout: 30_000 }));
  assert.ok(result.success, result.error); return result.data;
};
const evaluate = source => command('eval', source).result;
const cases = [], snapshots = [];
const snapshot = () => snapshots.push(command('snapshot', '-i'));
const report = () => evaluate('fetch("/test/report").then(response => response.json())');
const choices = ['bed', 'coffee', 'sun'];

for (const [language, label] of [['ja','シーンのアイコン'],['zh-Hans','场景图标'],['zh-Hant','場景圖示']]) {
  for (const [index, width] of [390,768,1440].entries()) {
    command('set', 'viewport', String(width), '900');
    command('open', 'http://localhost:38844'); command('wait', '.store-scene-edit'); snapshot();
    command('select', '.os-language-picker select', language);
    command('wait', `html[lang="${language}"]`); snapshot();
    command('click', '.store-scene-edit'); command('wait', 'dialog[open]'); snapshot();
    command('wait', '--text', label);
    const geometry = evaluate(`(() => {
      const dialog = document.querySelector('dialog[open]');
      const targets = [...dialog.querySelectorAll('.store-scene-icon-option > span')].map(el => {
        const r = el.getBoundingClientRect(); return {width:r.width,height:r.height};
      });
      return {legend:dialog.querySelector('legend').textContent, targets,
        pageOverflow:document.documentElement.scrollWidth>innerWidth, dialogOverflow:dialog.scrollWidth>dialog.clientWidth};
    })()`);
    assert.equal(geometry.legend, label); assert.equal(geometry.targets.length, 12);
    assert.ok(geometry.targets.every(r => r.width >= 44 && r.height >= 44));
    assert.equal(geometry.pageOverflow, false); assert.equal(geometry.dialogOverflow, false);
    const icon = choices[index];
    command('click', `.store-scene-icon-option:has(input[value="${icon}"])`);
    assert.equal(evaluate('document.querySelector("input[name=scene-icon]:checked").value'), icon);
    command('screenshot', `${output}/editor-${language}-${width}.png`);
    command('click', '.store-scene-editor-footer button[type=submit]');
    command('wait', 'body:not(:has(dialog[open]))'); snapshot();
    command('reload'); command('wait', '.store-scene-edit'); snapshot();
    const saved = await report(); assert.equal(saved.settings[0].settings.scenes[0].icon, icon);
    assert.equal(saved.posts.length, 0); assert.equal(saved.jobs, 0);
    command('click', '.store-scene-edit'); command('wait', 'dialog[open]'); snapshot();
    assert.equal(evaluate('document.querySelector("input[name=scene-icon]:checked").value'), icon);
    const revision = saved.settings[0].settings.revision;
    command('click', '.store-scene-icon-option:has(input[value="power"])');
    command('click', '.store-scene-editor-footer button.secondary-button');
    command('wait', 'body:not(:has(dialog[open]))'); snapshot();
    assert.equal((await report()).settings[0].settings.revision, revision, 'cancel never saves');
    cases.push({language,width,icon,persisted:true,cancelPreserved:true,...geometry});
    console.log(`PASS ${language} ${width}px: icons, save, reload, cancel, no overflow or hardware commands`);
  }
}
command('set', 'viewport', '390', '844'); command('click', '.store-scene-edit'); command('wait', 'dialog[open]'); snapshot();
command('click', '.store-scene-icon-option:has(input[value="bed"])');
command('focus', 'input[name=scene-icon][value=bed]'); command('press', 'ArrowRight');
assert.equal(evaluate('document.querySelector("input[name=scene-icon]:checked").value'), 'moon');
assert.equal(evaluate('getComputedStyle(document.activeElement.nextElementSibling).outlineStyle'), 'solid');
command('click', '.store-scene-icon-option:has(input[value="bed"])');
command('click', '.store-scene-editor-footer button[type=submit]'); command('wait', 'body:not(:has(dialog[open]))'); snapshot();
command('click', '.store-scene-run'); command('wait', 'dialog[open]'); snapshot();
assert.match(evaluate('document.querySelector(".store-scene-confirm-name svg").getAttribute("class")'), /bed-double/);
command('press', 'Escape'); command('wait', 'body:not(:has(dialog[open]))');
const final = await report(); assert.equal(final.posts.length, 0); assert.equal(final.jobs, 0);
const errors = command('errors');
assert.deepEqual(errors.errors, []);
writeFileSync(`${output}/browser-verification.json`, JSON.stringify({cases,keyboardSelection:true,visibleKeyboardFocus:true,confirmationIcon:true,hardwareCommands:0,errors,final},null,2)+'\n');
writeFileSync(`${output}/browser-snapshots.json`, JSON.stringify(snapshots,null,2)+'\n');
console.log('PASS keyboard radio selection, visible focus, confirmation icon; zero hardware commands.');
