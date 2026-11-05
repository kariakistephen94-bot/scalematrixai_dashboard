// Client for one whatsapp-gateway instance (one instance per WhatsApp account).

export class GatewayClient {
  constructor(account, fetchImpl = fetch) {
    this.account = account;
    this.fetch = fetchImpl;
  }

  async #call(method, path, body, timeoutMs) {
    const response = await this.fetch(this.account.url + path, {
      method,
      redirect: 'error',
      headers: { authorization: `Bearer ${this.account.apiKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json = null;
    try { json = await response.json(); } catch { /* non-JSON error body */ }
    return { ok: response.ok, status: response.status, json };
  }

  /** Never throws. */
  async status() {
    try {
      const r = await this.#call('GET', '/status', undefined, 5000);
      if (!r.ok || !r.json) return { reachable: true, connected: false, state: 'error' };
      return { reachable: true, connected: r.json.connected === true, state: r.json.state || 'unknown', needsQr: r.json.needsQr === true, me: r.json.me || null };
    } catch {
      return { reachable: false, connected: false, state: 'unreachable' };
    }
  }

  async qr() {
    try {
      const r = await this.#call('GET', '/qr.json', undefined, 5000);
      return r.ok ? r.json : null;
    } catch {
      return null;
    }
  }

  /**
   * Send a text message. Outcomes:
   *   accepted  - the gateway handed it to WhatsApp (has an id)
   *   failed    - the gateway answered with an error, so the message was definitely not sent
   *   uncertain - no answer (timeout/network); it may or may not have gone out, so it must not be retried
   */
  async send(to, text) {
    let r;
    try {
      r = await this.#call('POST', '/send', { to, text }, 60_000);
    } catch {
      return { outcome: 'uncertain', error: 'No response from the gateway; delivery unknown' };
    }
    if (r.ok && r.json?.id) return { outcome: 'accepted', id: String(r.json.id) };
    if (r.ok) return { outcome: 'uncertain', error: 'Gateway accepted the request without a message id' };
    return { outcome: 'failed', error: String(r.json?.error || `Gateway HTTP ${r.status}`).slice(0, 300) };
  }
}
