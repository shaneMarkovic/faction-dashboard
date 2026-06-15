import "server-only";
import { cookies } from "next/headers";
import { listFactions, loadDashboard, type Dashboard, type FactionSummary } from "./data";

/**
 * Resolves the active faction from the `faction` cookie (set by the switcher),
 * falling back to the first faction the user can see. Cookie-based so the
 * selection persists across all module pages without threading a query param.
 */
export async function resolveActiveFaction(): Promise<{
  factions: FactionSummary[];
  activeId: number;
}> {
  const factions = await listFactions();
  const store = await cookies();
  const cookieId = Number(store.get("faction")?.value);
  const hasCookie = Number.isInteger(cookieId) && cookieId > 0;

  // The cookie is authoritative: once the user picks a faction, that choice is
  // honored unconditionally and NEVER overridden by the faction list. The list
  // (which can momentarily flake on a DB blip) only chooses a default when no
  // selection exists. This is what makes the active faction stable across the
  // 15s LiveRefresh re-renders — the list never gets a vote in what's active.
  const activeId = hasCookie ? cookieId : (factions[0]?.id ?? 0);
  return { factions, activeId };
}

/** Convenience for module pages: resolve the active faction and load its data. */
export async function loadActiveDashboard(): Promise<Dashboard> {
  const { activeId } = await resolveActiveFaction();
  return loadDashboard(activeId);
}
