import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import puppeteer from "puppeteer-core";

const DEBUG_PORTS = {
  uber_eats: 9331,
  rocket_now: 9332,
  demae_can: 9333
};

async function firstWebPage(browser) {
  const targets = browser.targets()
    .filter((target) => target.type() === "page")
    .sort((left, right) => Number(right.url() !== "about:blank") - Number(left.url() !== "about:blank"));
  for (const target of targets) {
    const page = await target.page().catch(() => null);
    if (page) return page;
  }
  return browser.newPage();
}

export class BrowserSession {
  constructor(config, platform) {
    this.config = config;
    this.platform = platform;
    this.browser = null;
    this.page = null;
  }

  debuggingPort() {
    const port = DEBUG_PORTS[this.platform];
    if (!port) throw new Error(`Missing Chrome debugging port for ${this.platform}`);
    return port;
  }

  async ensureRunning() {
    const debuggingPort = this.debuggingPort();
    const endpoint = `http://127.0.0.1:${debuggingPort}/json/version`;
    const active = await fetch(endpoint, { signal: AbortSignal.timeout(1000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (active) return debuggingPort;
    const userDataDir = path.join(this.config.chromeProfilesRoot, this.platform);
    await mkdir(userDataDir, { recursive: true });
    const headless = this.config.platforms[this.platform]?.headless === true;
    const executable = headless ? this.config.chromeExecutablePath : "/usr/bin/open";
    const args = headless ? [
      "--headless=new",
      `--remote-debugging-port=${debuggingPort}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-allow-origins=*",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank"
    ] : [
      "-na",
      "Google Chrome",
      "--args",
      `--remote-debugging-port=${debuggingPort}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-allow-origins=*",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      "about:blank"
    ];
    const chromeProcess = spawn(executable, args, {
      detached: true,
      stdio: "ignore"
    });
    chromeProcess.unref();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const ready = await fetch(endpoint, { signal: AbortSignal.timeout(1000) })
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) return debuggingPort;
      await delay(250);
    }
    throw new Error(`Chrome did not start for ${this.platform}`);
  }

  async start() {
    if (this.browser?.connected) return this.page;
    const debuggingPort = await this.ensureRunning();
    try {
      this.browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${debuggingPort}`,
        defaultViewport: null,
        targetFilter: (target) => !target.url().startsWith("chrome://")
      });
      this.page = await firstWebPage(this.browser);
      this.page.setDefaultTimeout(15000);
      return this.page;
    } catch {
      this.browser = null;
      this.page = null;
    }
    let lastError;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        this.browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${debuggingPort}`,
          defaultViewport: null,
          targetFilter: (target) => !target.url().startsWith("chrome://")
        });
        break;
      } catch (error) {
        lastError = error;
        await delay(250);
      }
    }
    if (!this.browser) {
      throw new Error(`Chrome did not start for ${this.platform}: ${lastError instanceof Error ? lastError.message : lastError}`);
    }
    this.page = await firstWebPage(this.browser);
    this.page.setDefaultTimeout(15000);
    return this.page;
  }

  async goto(url) {
    const page = await this.start();
    if (page.url() !== url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
    }
    return page;
  }

  async close() {
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.browser = null;
    this.page = null;
  }

  async disconnect() {
    if (this.browser) this.browser.disconnect();
    this.browser = null;
    this.page = null;
  }
}
