/**
 * Postgres sink — persists collected snapshots to Supabase (PLAN §9).
 *
 * Writes via the connection-string credentials (service-level), so RLS does
 * not gate these writes. Upserts keep the latest state; chain_snapshots is
 * append-only for history. Call ensureFaction() once before polling so the
 * faction row (FK target) exists.
 */

import type {
  ChainSnapshot,
  FactionBalance,
  FactionBasic,
  Member,
  MemberBalance,
  OcCrime,
  RankedWar,
} from "@torn/shared";
import type { Pool } from "pg";
import type { Sink } from "../sink";

export class PostgresSink implements Sink {
  constructor(private readonly pool: Pool) {}

  /** Upsert the faction row so domain FKs resolve. */
  async ensureFaction(basic: FactionBasic): Promise<void> {
    await this.pool.query(
      `insert into factions (id, name, tag) values ($1, $2, $3)
       on conflict (id) do update set name = excluded.name, tag = excluded.tag`,
      [basic.id, basic.name, basic.tag],
    );
  }

  async writeMembers(members: Member[]): Promise<void> {
    if (members.length === 0) return;
    const cols = 15;
    const values: unknown[] = [];
    const tuples = members.map((m, i) => {
      const b = i * cols;
      values.push(
        m.tornId, m.factionId, m.name, m.position, m.level, m.daysInFaction,
        m.statusState, m.statusUntil, m.statusDescription, m.lastActionTs,
        m.isOnWall, m.isInOc, m.isRevivable, m.reviveSetting, m.hasEarlyDischarge,
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15})`;
    });
    await this.pool.query(
      `insert into members (
         torn_id, faction_id, name, position, level, days_in_faction,
         status_state, status_until, status_description, last_action_ts,
         is_on_wall, is_in_oc, is_revivable, revive_setting, has_early_discharge
       ) values ${tuples.join(",")}
       on conflict (faction_id, torn_id) do update set
         name = excluded.name, position = excluded.position, level = excluded.level,
         days_in_faction = excluded.days_in_faction, status_state = excluded.status_state,
         status_until = excluded.status_until, status_description = excluded.status_description,
         last_action_ts = excluded.last_action_ts, is_on_wall = excluded.is_on_wall,
         is_in_oc = excluded.is_in_oc, is_revivable = excluded.is_revivable,
         revive_setting = excluded.revive_setting, has_early_discharge = excluded.has_early_discharge,
         updated_at = now()`,
      values,
    );
  }

  async writeChain(c: ChainSnapshot): Promise<void> {
    await this.pool.query(
      `insert into chain_snapshots (faction_id, chain_id, current, max, timeout, cooldown, modifier)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [c.factionId, c.chainId, c.current, c.max, c.timeout, c.cooldown, c.modifier],
    );
  }

  async writeCrimes(crimes: OcCrime[]): Promise<void> {
    for (const c of crimes) {
      await this.pool.query(
        `insert into oc_crimes (id, faction_id, name, difficulty, status, ready_at, expired_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (id) do update set
           status = excluded.status, ready_at = excluded.ready_at,
           expired_at = excluded.expired_at, updated_at = now()`,
        [c.id, c.factionId, c.name, c.difficulty, c.status, c.readyAt, c.expiredAt],
      );
      // Replace slots for this crime (positions/assignments change over time).
      await this.pool.query("delete from oc_slots where crime_id = $1", [c.id]);
      for (let i = 0; i < c.slots.length; i++) {
        const s = c.slots[i]!;
        await this.pool.query(
          `insert into oc_slots (crime_id, position, slot_index, user_id, cpr, ready_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [c.id, s.position, i, s.userId, s.cpr, s.readyAt],
        );
      }
    }
  }

  async writeWars(wars: RankedWar[]): Promise<void> {
    for (const w of wars) {
      await this.pool.query(
        `insert into wars (id, faction_id, opponent_id, opponent_name, score, opponent_score, target, start_ts, end_ts, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         on conflict (id) do update set
           score = excluded.score, opponent_score = excluded.opponent_score,
           end_ts = excluded.end_ts, updated_at = now()`,
        [w.id, w.factionId, w.opponentId, w.opponentName, w.score, w.opponentScore, w.target, w.start, w.end],
      );
    }
  }

  async writeBalance(b: FactionBalance): Promise<void> {
    await this.pool.query(
      `insert into balances (faction_id, money, points, updated_at)
       values ($1,$2,$3, now())
       on conflict (faction_id) do update set
         money = excluded.money, points = excluded.points, updated_at = now()`,
      [b.factionId, b.money, b.points],
    );
  }

  async writeMemberBalances(balances: MemberBalance[]): Promise<void> {
    if (balances.length === 0) return;
    const cols = 5;
    const values: unknown[] = [];
    const tuples = balances.map((b, i) => {
      const o = i * cols;
      values.push(b.factionId, b.memberId, b.name, b.money, b.points);
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5})`;
    });
    await this.pool.query(
      `insert into member_balances (faction_id, member_id, name, money, points)
       values ${tuples.join(",")}
       on conflict (faction_id, member_id) do update set
         name = excluded.name, money = excluded.money,
         points = excluded.points, updated_at = now()`,
      values,
    );
  }
}
