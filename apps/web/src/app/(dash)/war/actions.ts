"use server";

import { getPool } from "@/lib/db";
import type { WarRules } from "@/lib/data";

/**
 * Save the faction's war-enforcement rule targets. The collector reads these on
 * its next war cycle and recomputes block state. (Admin gating comes with the
 * Discord-auth phase; for now this writes via the server connection.)
 */
export async function saveWarRules(
  factionId: number,
  rules: WarRules,
): Promise<{ ok: boolean; error?: string }> {
  const vals = [
    rules.totalScoreTarget,
    rules.perMemberScoreTarget,
    rules.maxAttacksPerMember,
    rules.idleMinutesTarget,
  ];
  if (!vals.every((n) => Number.isInteger(n) && n >= 0)) {
    return { ok: false, error: "Targets must be 0 or a positive integer." };
  }
  const pool = getPool();
  if (!pool) return { ok: false, error: "Database not configured." };
  try {
    await pool.query(
      `insert into war_rules (faction_id, total_score_target, per_member_score_target, max_attacks_per_member, idle_minutes_target, updated_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (faction_id) do update set
         total_score_target = excluded.total_score_target,
         per_member_score_target = excluded.per_member_score_target,
         max_attacks_per_member = excluded.max_attacks_per_member,
         idle_minutes_target = excluded.idle_minutes_target,
         updated_at = now()`,
      [factionId, ...vals],
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
