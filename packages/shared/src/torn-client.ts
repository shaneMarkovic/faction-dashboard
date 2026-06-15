/**
 * Minimal Torn API v2 client.
 *
 * Owns ALL outbound Torn traffic (see PLAN §3). One instance per API key.
 * The key is passed as an `Authorization: ApiKey <key>` header and never logged.
 */

const BASE_URL = "https://api.torn.com/v2";

export class TornApiError extends Error {
  constructor(
    public code: number,
    public override message: string,
    public endpoint: string,
  ) {
    super(`Torn API error ${code} on ${endpoint}: ${message}`);
    this.name = "TornApiError";
  }
}

export interface TornClientOptions {
  /** Abort each request after this many ms. */
  timeoutMs?: number;
}

export class TornClient {
  private readonly key: string;
  private readonly timeoutMs: number;

  constructor(key: string, opts: TornClientOptions = {}) {
    this.key = key;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /**
   * GET a Torn v2 endpoint. `path` is relative to the v2 base, e.g.
   * "/faction/chain". `query` is appended as URL search params.
   */
  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `ApiKey ${this.key}` },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new TornApiError(res.status, res.statusText, path);
    }

    const body = (await res.json()) as T & {
      error?: { code: number; error: string };
    };

    // Torn returns HTTP 200 with an { error } envelope for app-level errors
    // (e.g. 7 = no faction permission, 2 = incorrect key).
    if (body && typeof body === "object" && "error" in body && body.error) {
      throw new TornApiError(body.error.code, body.error.error, path);
    }
    return body;
  }
}
