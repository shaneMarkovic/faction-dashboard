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
  const activeId = factions.some((f) => f.id === cookieId)
    ? cookieId
    : (factions[0]?.id ?? 0);
  return { factions, activeId };
}

/** Convenience for module pages: resolve the active faction and load its data. */
export async function loadActiveDashboard(): Promise<Dashboard> {
  const { activeId } = await resolveActiveFaction();
  return loadDashboard(activeId);
}
