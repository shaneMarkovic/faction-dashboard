"use server";

import { revalidatePath } from "next/cache";
import { TornClient, fetchKeyInfo, encryptKey, encryptionKey } from "@torn/shared";
import { tryQuery } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Validate and store a member's PERSONAL finance key (encrypted). The key must
 * belong to the logged-in member and grant at least Limited access. Replaces
 * any previously connected personal key.
 */
export async function connectFinanceKey(
  rawKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = (rawKey || "").trim();
  if (!key) return { ok: false, error: "Enter your Torn API key." };

  const session = await getSession();
  if (!session) return { ok: false, error: "Session expired — sign in again." };

  let info;
  try {
    info = await fetchKeyInfo(new TornClient(key));
  } catch {
    return { ok: false, error: "Invalid key, or Torn API unreachable." };
  }

  if (info.userId !== session.tornId) {
    return { ok: false, error: "That key belongs to a different Torn account." };
  }

  // Validate by GRANTED SELECTIONS, not access level: a Custom key reports a low
  // numeric level but still grants exactly the selections it was created with.
  // A Full Access key grants everything.
  const REQUIRED = ["money", "personalstats", "log", "travel", "stocks"];
  if (info.accessType !== "Full Access") {
    const granted = new Set(info.userSelections);
    const missing = REQUIRED.filter((s) => !granted.has(s));
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Key is missing required permissions: ${missing.join(", ")}. Re-create a Custom key with all listed selections.`,
      };
    }
  }

  let encrypted: Buffer;
  try {
    encrypted = encryptKey(key, encryptionKey());
  } catch {
    return { ok: false, error: "Server can't store keys right now. Try again later." };
  }

  // Replace any prior personal key for this member, then insert the new one.
  const revoked = await tryQuery(
    "update api_keys set revoked = true where member_id = $1 and purpose = 'personal' and not revoked",
    [session.tornId],
  );
  if (revoked == null) return { ok: false, error: "Server unavailable. Try again." };

  const saved = await tryQuery(
    `insert into api_keys (member_id, faction_id, encrypted_key, access_level, has_faction_access, purpose)
     values ($1, $2, $3, $4, false, 'personal')`,
    [session.tornId, session.factionId, encrypted, info.accessType || info.accessLevel],
  );
  if (saved == null) return { ok: false, error: "Couldn't save your key. Try again." };

  revalidatePath("/finance", "layout");
  return { ok: true };
}

export async function disconnectFinanceKey(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await tryQuery(
    "update api_keys set revoked = true where member_id = $1 and purpose = 'personal' and not revoked",
    [session.tornId],
  );
  revalidatePath("/finance", "layout");
}

export async function setTravelCapacity(capacity: number): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const clamped = Math.max(1, Math.min(50, Math.round(capacity)));
  await tryQuery(
    `insert into user_finance_prefs (member_id, travel_capacity, updated_at)
     values ($1, $2, now())
     on conflict (member_id) do update set travel_capacity = excluded.travel_capacity, updated_at = now()`,
    [session.tornId, clamped],
  );
  revalidatePath("/finance/flying");
}
