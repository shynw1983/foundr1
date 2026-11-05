const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;

test('npm build/dev generate versions before Next while preserving the prebuild lifecycle', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'foundr1-version-lifecycle-'));
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'node_modules/.bin'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'version-lifecycle-fixture', private: true,
      scripts: { build: scripts.build, dev: scripts.dev, prebuild: 'node prebuild.cjs' } }));
    fs.writeFileSync(path.join(fixture, 'prebuild.cjs'), "require('fs').appendFileSync('order.log','prebuild\\n');");
    fs.writeFileSync(path.join(fixture, 'scripts/app-web-versions.cjs'), "const fs=require('fs');fs.writeFileSync('ready','yes');fs.appendFileSync('order.log','versions\\n');");
    const next = path.join(fixture, 'node_modules/.bin/next');
    fs.writeFileSync(next, '#!' + process.execPath + "\nconst fs=require('fs');if(!fs.existsSync('ready'))process.exit(2);fs.appendFileSync('order.log','next:'+process.argv.slice(2).join(',')+'\\n');\n");
    fs.chmodSync(next, 0o755);
    for (const [name, args, expected] of [
      ['build', ['--', '--webpack'], ['prebuild', 'versions', 'next:build,--webpack']],
      ['dev', [], ['versions', 'next:dev']]
    ]) {
      fs.rmSync(path.join(fixture, 'order.log'), { force: true });
      fs.rmSync(path.join(fixture, 'ready'), { force: true });
      const result = spawnSync('npm', ['run', name, ...args], { cwd: fixture, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, npm_config_update_notifier: 'false', npm_config_audit: 'false' } });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(fs.readFileSync(path.join(fixture, 'order.log'), 'utf8').trim().split('\n'), expected);
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('runtime Next configuration has no source-scanning generator dependency', () => {
  const config = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  assert(!config.includes('generateAppVersions'));
  assert(!config.includes('app-web-versions.cjs'));
  assert(config.includes('withWorkflow(nextConfig)'));
});
