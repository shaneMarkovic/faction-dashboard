/**
 * Web-side YATA access: cached serving with a last-good fallback so a transient
 * failure doesn't flap the UI. The raw fetch + types live in @torn/shared (also
 * used by the collector's stock recorder).
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { fetchYataExport, type YataCountryStock } from "@torn/shared";

export { COUNTRY_NAMES } from "@torn/shared";
export type { YataCountryStock, YataStockItem } from "@torn/shared";

// Last successful fetch, kept in-memory so a transient YATA failure serves
// slightly-stale stock instead of flipping the UI to "unavailable".
let lastGood: { data: YataCountryStock[]; at: number } | null = null;
const LAST_GOOD_MAX_AGE_MS = 30 * 60_000;

export const loadYataTravel = unstable_cache(
  async (): Promise<YataCountryStock[]> => {
    // Two attempts (fetchYataExport returns [] on failure) before falling back.
    let data = await fetchYataExport();
    if (data.length === 0) data = await fetchYataExport();
    if (data.length > 0) {
      lastGood = { data, at: Date.now() };
      return data;
    }
    if (lastGood && Date.now() - lastGood.at < LAST_GOOD_MAX_AGE_MS) return lastGood.data;
    return [];
  },
  ["yata-travel"],
  { revalidate: 120 },
);
