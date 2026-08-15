import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEMAE_KEYCHAIN_SERVICE = "jp.foundr1.desktop-bridge.demae-can";

const ACCOUNTS = {
  handleCode: "handle-code",
  loginId: "login-id",
  password: "password"
};

async function readKeychainValue(account, run = execFileAsync) {
  try {
    const { stdout } = await run("/usr/bin/security", [
      "find-generic-password", "-s", DEMAE_KEYCHAIN_SERVICE, "-a", account, "-w"
    ], { encoding: "utf8", maxBuffer: 4096 });
    return String(stdout ?? "").replace(/[\r\n]+$/u, "");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && Number(error.code) === 44) return "";
    throw new Error("demae_can_keychain_unavailable", { cause: error });
  }
}

export async function loadDemaeCredentials(run = execFileAsync) {
  const [handleCode, loginId, password] = await Promise.all([
    readKeychainValue(ACCOUNTS.handleCode, run),
    readKeychainValue(ACCOUNTS.loginId, run),
    readKeychainValue(ACCOUNTS.password, run)
  ]);
  if (!handleCode || !loginId || !password) throw new Error("demae_can_credentials_missing");
  return { handleCode, loginId, password };
}

export const DEMAE_KEYCHAIN_ACCOUNTS = ACCOUNTS;
