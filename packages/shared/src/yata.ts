/**
 * YATA travel export — community-sourced foreign shop stock + prices.
 *
 * The official Torn API does not expose live foreign stock, so the Flying
 * helper reads it from YATA (https://yata.yt). Shared so both the web (cached
 * serving) and the collector (append-only recorder) use one fetch + parse.
 */

export interface YataStockItem {
  id: number;
  name: string;
  /** Units currently in stock abroad. */
  quantity: number;
  /** Foreign buy price. */
  cost: number;
}

export interface YataCountryStock {
  countryCode: string;
  /** Unix seconds of YATA's last update for this country (its `update` field). */
  updatedAt: number;
  items: YataStockItem[];
}

interface RawYata {
  stocks?: Record<
    string,
    { update?: number; stocks?: { id: number; name: string; quantity: number; cost: number }[] }
  >;
}

/** YATA country codes → display names. */
export const COUNTRY_NAMES: Record<string, string> = {
  mex: "Mexico",
  cay: "Cayman Islands",
  can: "Canada",
  haw: "Hawaii",
  uni: "United Kingdom",
  arg: "Argentina",
  swi: "Switzerland",
  jap: "Japan",
  chi: "China",
  uae: "UAE",
  sou: "South Africa",
};

/** One-shot fetch + parse of the YATA travel export. Returns [] on failure. */
export async function fetchYataExport(timeoutMs = 10_000): Promise<YataCountryStock[]> {
  try {
    const res = await fetch("https://yata.yt/api/v1/travel/export/", {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as RawYata;
    return Object.entries(body.stocks ?? {}).map(([code, c]) => ({
      countryCode: code,
      updatedAt: Number(c.update ?? 0),
      items: (c.stocks ?? []).map((s) => ({
        id: Number(s.id),
        name: String(s.name),
        quantity: Number(s.quantity),
        cost: Number(s.cost),
      })),
    }));
  } catch {
    return [];
  }
}
