export class BridgeApiClient {
  constructor(config) {
    this.config = config;
  }

  commandUrl() {
    const params = new URLSearchParams({
      storeId: this.config.storeId,
      platformMode: "desktop"
    });
    return `${this.config.serverUrl}/api/local-bridge/uber-eats/commands?${params}`;
  }

  async request(url, init = {}) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.bridgeToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {})
      },
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Foundr1 HTTP ${response.status}: ${body.error ?? "request failed"}`);
    return body;
  }

  async nextCommand() {
    return (await this.request(this.commandUrl())).command ?? null;
  }

  async acknowledge(commandId, status, result = {}, error = "") {
    return this.request(this.commandUrl(), {
      method: "POST",
      body: JSON.stringify({ commandId, status, result, error })
    });
  }

  async reportStatus(status) {
    return this.request(`${this.config.serverUrl}/api/local-bridge/uber-eats/status`, {
      method: "POST",
      body: JSON.stringify({
        storeId: this.config.storeId,
        versionName: "desktop-0.1.0",
        platformMode: "desktop",
        primaryPlatform: "uber_eats",
        ...status
      })
    });
  }
}
