import { setTimeout as delay } from "node:timers/promises";

import WebSocket from "ws";

export class CdpPage {
  constructor(port, urlPrefix, webSocketUrl) {
    this.port = port;
    this.urlPrefix = urlPrefix;
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.sessionId = "";
    this.nextId = 1;
    this.pending = new Map();
  }

  static async connect(port, urlPrefix, { isolated = false, reuse = false } = {}) {
    const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (!versionResponse.ok) throw new Error(`Chrome version endpoint failed: ${versionResponse.status}`);
    const version = await versionResponse.json();
    if (!version.webSocketDebuggerUrl) throw new Error("Chrome browser WebSocket is missing");
    const client = new CdpPage(port, urlPrefix, version.webSocketDebuggerUrl);
    try {
      await client.open();
      if (isolated) {
        // Reuse is opt-in for the dedicated competitor profile, never a fallback
        // to an arbitrary merchant tab.
        const targets = reuse ? await client.send('Target.getTargets', {}, true) : null;
        const existing = targets?.targetInfos?.find(target => target.type === 'page' && target.url.startsWith(urlPrefix));
        const target = existing ?? await client.send("Target.createTarget", { url: "about:blank" }, true);
        client.ownedTargetId = target.targetId;
        client.reusedTarget = Boolean(existing);
      }
      await client.attach();
      return client;
    } catch (error) {
      await client.dispose();
      throw error;
    }
  }

  async targetId(expectedPrefix = this.urlPrefix) {
    const response = await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Chrome target list failed: ${response.status}`);
    const targets = await response.json();
    const target = targets.find((item) => item.type === "page" && String(item.url).startsWith(expectedPrefix))
      ?? targets.find((item) => item.type === "page" && String(item.url).startsWith(this.urlPrefix))
      ?? targets.find((item) => item.type === "page");
    if (!target?.id) throw new Error(`Chrome page missing for ${expectedPrefix}`);
    return target.id;
  }

  async open() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP WebSocket timeout")), 5000);
      this.socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket connection failed"));
      });
    });
    this.socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.on("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("CDP WebSocket closed"));
      this.pending.clear();
    });
  }

  async attach(expectedPrefix = this.urlPrefix) {
    const targetId = this.ownedTargetId || await this.targetId(expectedPrefix);
    const result = await this.send("Target.attachToTarget", { targetId, flatten: true }, true);
    this.sessionId = result.sessionId;
  }

  async send(method, params = {}, root = false) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("CDP WebSocket is not open");
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timeout`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });
    });
    this.socket.send(JSON.stringify({
      id,
      method,
      params,
      ...(!root && this.sessionId ? { sessionId: this.sessionId } : {})
    }));
    return result;
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "CDP evaluation failed");
    }
    return response.result?.value;
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await delay(500);
    await this.attach(url).catch(() => this.attach());
    await this.waitFor(`location.href.startsWith(${JSON.stringify(url)})`);
  }

  async waitFor(expression, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate(expression)) return;
      } catch (error) {
        lastError = error;
        await this.attach().catch(() => undefined);
      }
      await delay(250);
    }
    throw new Error(`CDP condition timed out${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
  }

  close() {
    this.socket?.close();
    this.socket = null;
    this.sessionId = "";
  }

  async dispose({ keepOpen = false } = {}) {
    try {
      if (this.ownedTargetId && !keepOpen) {
        await this.send("Target.closeTarget", { targetId: this.ownedTargetId }, true);
      }
    } catch {
      // Cleanup must not replace the actual task error. Never close another tab.
    } finally {
      this.close();
    }
  }
}
