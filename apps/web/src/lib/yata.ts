/**
 * YATA travel export — community-sourced foreign shop stock + prices.
 *
 * The official Torn API does not expose live foreign stock counts, so the
 * Flying helper reads them from YATA (https://yata.yt). This is a SHARED read
 * (not per-user): one cached fetch serves every member. Degrades gracefully to
 * an empty list on any failure so the page never hard-errors.
 */

import "server-only";
import { unstable_cache } from "next/cache";

export interface YataStockItem {
  id: number;
  name: string;
  /** Units currently in stock abroad. */
  quantity: number;
  /** Foreign buy price (what you pay abroad). */
  cost: number;
}

export interface YataCountryStock {
  countryCode: string;
  /** Unix seconds of the last YATA update for this country. */
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

export const loadYataTravel = unstable_cache(
  async (): Promise<YataCountryStock[]> => {
    try {
      const res = await fetch("https://yata.yt/api/v1/travel/export/", {
        signal: AbortSignal.timeout(10_000),
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
  },
  ["yata-travel"],
  { revalidate: 120 }, // foreign stock shifts on the order of minutes
);
