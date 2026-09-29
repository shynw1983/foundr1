import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { root, loadConfig } from '../src/config.mjs';

const run = promisify(execFile), checkOnly = process.argv.includes('--prepare-only');
if (process.platform !== 'darwin') throw new Error('This installer requires macOS.');
await loadConfig();
await mkdir(path.join(root, '.runtime'), { recursive: true, mode: 0o700 });
await run('/usr/bin/swiftc', [path.join(root, 'macos/keychain.swift'), '-module-cache-path', path.join(root, '.runtime/swift-cache'), '-o', path.join(root, '.runtime/keychain'), '-framework', 'Security'], { timeout: 60_000 });
if (!checkOnly) {
  const logs = path.join(homedir(), 'Library/Logs/Foundr1 Camera Bridge');
  const agents = path.join(homedir(), 'Library/LaunchAgents');
  await mkdir(logs, { recursive: true, mode: 0o700 }); await mkdir(agents, { recursive: true });
  const esc = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>jp.foundr1.camera-bridge</string><key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(path.join(root, 'src/main.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${esc(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer>
<key>StandardOutPath</key><string>${esc(path.join(logs, 'output.log'))}</string><key>StandardErrorPath</key><string>${esc(path.join(logs, 'error.log'))}</string></dict></plist>`;
  const target = path.join(agents, 'jp.foundr1.camera-bridge.plist');
  await writeFile(target, plist, { mode: 0o600 });
  await run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/jp.foundr1.camera-bridge`]).catch(() => {});
  await run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, target]);
  console.log('Camera Bridge installed. The existing Desktop Bridge was not restarted.');
} else console.log('Keychain helper compiled. No service installed.');
