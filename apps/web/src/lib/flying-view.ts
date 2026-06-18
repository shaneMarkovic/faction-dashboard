/**
 * Shared client-side view state for the Flying table, so both the table's own
 * controls AND the AI co-pilot can drive filter/sort. A tiny external store
 * (no dependency) shared across sibling components via useSyncExternalStore.
 *
 * Persisted prefs (capacity, time reduction) are NOT here — those go through the
 * server actions in finance/actions.ts. This is purely the in-page view.
 */

import { useSyncExternalStore } from "react";

export type FlyingSortKey =
  | "profitPerHour"
  | "tripProfit"
  | "profitPerItem"
  | "roiPct"
  | "stock"
  | "predictedOnArrival";

export interface FlyingView {
  /** "all" or a country name. */
  country: string;
  sort: FlyingSortKey;
  asc: boolean;
  under5h: boolean;
  /** Minimum arrival odds 0..1; 0 = off. Only applies to confident forecasts. */
  minOdds: number;
}

const DEFAULT: FlyingView = {
  country: "all",
  sort: "profitPerHour",
  asc: false,
  under5h: false,
  minOdds: 0,
};

let state: FlyingView = DEFAULT;
const listeners = new Set<() => void>();

export function setFlyingView(patch: Partial<FlyingView>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): FlyingView {
  return state;
}

export function useFlyingView(): FlyingView {
  // getServerSnapshot returns the stable default so SSR and first client render match.
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT);
}
