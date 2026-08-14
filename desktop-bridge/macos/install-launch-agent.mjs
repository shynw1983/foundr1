import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const bridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFilename = path.join(bridgeRoot, "config.local.json");
const config = JSON.parse(await readFile(configFilename, "utf8"));
if (config.executionEnabled !== true) {
  throw new Error("Refusing to install: executionEnabled must be true after the live round-trip test.");
}

const escapeXml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");
const label = "jp.foundr1.desktop-bridge";
const launchAgents = path.join(homedir(), "Library", "LaunchAgents");
const logs = path.join(homedir(), "Library", "Logs", "Foundr1 Desktop Bridge");
const plistFilename = path.join(launchAgents, `${label}.plist`);
await mkdir(launchAgents, { recursive: true });
await mkdir(logs, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(path.join(bridgeRoot, "src", "main.mjs"))}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(bridgeRoot)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escapeXml(path.join(logs, "bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(path.join(logs, "bridge-error.log"))}</string>
</dict>
</plist>
`;
await writeFile(plistFilename, plist, { mode: 0o644 });

const domain = `gui/${process.getuid()}`;
await execute("launchctl", ["bootout", domain, plistFilename]).catch(() => undefined);
await execute("launchctl", ["bootstrap", domain, plistFilename]);
await execute("launchctl", ["kickstart", "-k", `${domain}/${label}`]);
console.log(JSON.stringify({ ok: true, label, plistFilename, logs }, null, 2));
