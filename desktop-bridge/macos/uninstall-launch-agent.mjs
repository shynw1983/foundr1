import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const label = "jp.foundr1.desktop-bridge";
const plistFilename = path.join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
await execute("launchctl", ["bootout", `gui/${process.getuid()}`, plistFilename]).catch(() => undefined);
console.log(JSON.stringify({ ok: true, label, plistFilename }, null, 2));
