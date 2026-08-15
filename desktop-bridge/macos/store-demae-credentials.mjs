import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import process from "node:process";

import { DEMAE_KEYCHAIN_ACCOUNTS, DEMAE_KEYCHAIN_SERVICE } from "../src/demae-credentials.mjs";

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("请在 Mac 的 Terminal 中运行此命令，才能安全输入密码。");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("已取消。"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

function saveKeychainValue(account, value) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", [
      "add-generic-password", "-U", "-s", DEMAE_KEYCHAIN_SERVICE,
      "-a", account, "-T", "/usr/bin/security", "-w", value
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`无法写入 Mac 钥匙串：${stderr.trim() || `security ${code}`}`));
    });
    // The value is passed directly to the local Keychain process and is never
    // written to a config file, source file, terminal history, or Bridge log.
  });
}

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
try {
  console.log("出前馆自动重登设置（内容只保存到当前 Mac 用户的登录钥匙串）");
  const handleCode = (await prompt.question("代码／店铺登录 ID: ")).trim();
  const loginId = (await prompt.question("登录 ID／用户名: ")).trim();
  prompt.close();
  const password = await readHidden("密码（输入时不显示）: ");
  if (!handleCode || !loginId || !password) throw new Error("三项内容都必须填写。");
  await saveKeychainValue(DEMAE_KEYCHAIN_ACCOUNTS.handleCode, handleCode);
  await saveKeychainValue(DEMAE_KEYCHAIN_ACCOUNTS.loginId, loginId);
  await saveKeychainValue(DEMAE_KEYCHAIN_ACCOUNTS.password, password);
  console.log("已安全保存。Bridge 会在确认出前馆退出后自动重新登录。");
  console.log("请运行 npm run check:demae 验证登录状态。");
} finally {
  prompt.close();
}
