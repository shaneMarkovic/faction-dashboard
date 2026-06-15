/**
 * War Enforcer (inspired by torn-war-enforcer.js, MIT — KamiRen [2805199]).
 *
 * During an active ranked war, computes per-member contribution + block state
 * against the faction's rule targets, and snapshots the opponent roster's
 * last-action times. Writes the denormalized war_state / member_progress /
 * enemy_status tables the userscript reads. Faction-scoped for multi-tenancy.
 */

import {
  fetchEnemyStatuses,
  fetchFactionAttacks,
  fetchRankedWarReport,
  type FactionId,
  type RankedWar,
  type TornClient,
} from "@torn/shared";
import type { Pool } from "pg";

export interface WarRules {
  totalScoreTarget: number;
  perMemberScoreTarget: number;
  maxAttacksPerMember: number;
  idleMinutesTarget: number;
}

const DEFAULT_RULES: WarRules = {
  totalScoreTarget: 0,
  perMemberScoreTarget: 0,
  maxAttacksPerMember: 0,
  idleMinutesTarget: 10,
};

export class WarEnforcer {
  /** war_id → last attack `started` ts processed (for incremental aggregation). */
  private readonly cursors = new Map<number, number>();

  constructor(private readonly pool: Pool) {}

  private async getRules(factionId: FactionId): Promise<WarRules> {
    const { rows } = await this.pool.query(
      `select total_score_target, per_member_score_target, max_attacks_per_member, idle_minutes_target
         from war_rules where faction_id = $1`,
      [factionId],
    );
    if (rows.length === 0) {
      // Seed a default (no-limit) row so admins have something to edit.
      await this.pool.query(
        `insert into war_rules (faction_id, idle_minutes_target) values ($1, $2)
         on conflict (faction_id) do nothing`,
        [factionId, DEFAULT_RULES.idleMinutesTarget],
      );
      return DEFAULT_RULES;
    }
    const r = rows[0];
    return {
      totalScoreTarget: Number(r.total_score_target),
      perMemberScoreTarget: Number(r.per_member_score_target),
      maxAttacksPerMember: Number(r.max_attacks_per_member),
      idleMinutesTarget: Number(r.idle_minutes_target),
    };
  }

  /**
   * Run one enforcement cycle for an active war.
   *
   * Faction-score cap + activity rule use only LIVE PUBLIC data (the rankedwars
   * score passed in, and the opponent's public roster), so this works even for
   * a faction we only scout. Per-member caps need per-member contribution,
   * which `rankedwarreport` only provides AFTER a war ends — so mid-war we skip
   * it gracefully (until live attack-log aggregation lands, which needs a
   * faction-access key for that faction).
   */
  async run(
    client: TornClient,
    factionId: FactionId,
    war: RankedWar,
    opts: { liveMembers?: boolean } = {},
  ): Promise<void> {
    const rules = await this.getRules(factionId);
    const ourScore = war.score; // live, from /faction/rankedwars

    const factionBlocked =
      rules.totalScoreTarget > 0 && ourScore >= rules.totalScoreTarget;

    // war_state — the single row the userscript reads.
    await this.pool.query(
      `insert into war_state (
         faction_id, active, enlisted, war_id, opponent_id, opponent_name, start_ts,
         our_score, opponent_score, faction_blocked,
         total_score_target, per_member_score_target, max_attacks_per_member, idle_minutes_target, updated_at
       ) values ($1,true,true,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       on conflict (faction_id) do update set
         active = true, enlisted = true, war_id = excluded.war_id,
         opponent_id = excluded.opponent_id, opponent_name = excluded.opponent_name,
         start_ts = excluded.start_ts, our_score = excluded.our_score,
         opponent_score = excluded.opponent_score, faction_blocked = excluded.faction_blocked,
         total_score_target = excluded.total_score_target,
         per_member_score_target = excluded.per_member_score_target,
         max_attacks_per_member = excluded.max_attacks_per_member,
         idle_minutes_target = excluded.idle_minutes_target, updated_at = now()`,
      [
        factionId, war.id, war.opponentId, war.opponentName, war.start,
        ourScore, war.opponentScore, factionBlocked,
        rules.totalScoreTarget, rules.perMemberScoreTarget,
        rules.maxAttacksPerMember, rules.idleMinutesTarget,
      ],
    );

    // member_progress — per-member caps.
    if (opts.liveMembers) {
      // We hold a faction-access key → aggregate live from the attack log.
      try {
        await this.aggregateMembersFromAttacks(client, factionId, war, rules, factionBlocked);
      } catch (err) {
        console.warn(`[enforcer] faction ${factionId} attack aggregation failed:`, String(err));
      }
    } else {
      // No key for this faction (scouting). rankedwarreport is post-war only;
      // try it (fills in once the war ends), skip silently mid-war.
      try {
        const report = await fetchRankedWarReport(client, war.id);
        const ours = report.factions.find((f) => f.id === factionId);
        for (const m of ours?.members ?? []) {
          await this.pool.query(
            `insert into member_progress (faction_id, war_id, member_id, name, score, attacks, updated_at)
             values ($1,$2,$3,$4,$5,$6, now())
             on conflict (war_id, member_id) do update set
               name = excluded.name, score = excluded.score, attacks = excluded.attacks, updated_at = now()`,
            [factionId, war.id, m.memberId, m.name, m.score, m.attacks],
          );
        }
        if (ours?.members.length) await this.recomputeBlocked(war.id, factionBlocked, rules);
      } catch {
        /* mid-war: per-member not available yet */
      }
    }

    // enemy_status — opponent roster last-action (drives the activity rule).
    if (war.opponentId) {
      const enemies = await fetchEnemyStatuses(client, war.opponentId);
      for (const e of enemies) {
        await this.pool.query(
          `insert into enemy_status (faction_id, war_id, member_id, name, last_action_ts, state, updated_at)
           values ($1,$2,$3,$4,$5,$6, now())
           on conflict (war_id, member_id) do update set
             name = excluded.name, last_action_ts = excluded.last_action_ts,
             state = excluded.state, updated_at = now()`,
          [factionId, war.id, e.memberId, e.name, e.lastActionTs, e.state],
        );
      }
    }
  }

  /**
   * Incrementally aggregate per-member ranked-war contribution from the live
   * attack log. Hits = count of ranked-war attacks by our members; score = sum
   * of respect gained on those hits (≈ ranked-war score). Uses a per-war cursor
   * so each cycle only fetches new attacks; on first sight of a war (e.g. after
   * a restart) it rebuilds from war start.
   */
  private async aggregateMembersFromAttacks(
    client: TornClient,
    factionId: FactionId,
    war: RankedWar,
    rules: WarRules,
    factionBlocked: boolean,
  ): Promise<void> {
    let cursor = this.cursors.get(war.id);
    if (cursor === undefined) {
      // Cold start (process restart / first sight): resume from the durable
      // cursor if we have one; only rebuild from war start when truly fresh.
      const { rows } = await this.pool.query(
        "select last_started from war_cursors where war_id = $1",
        [war.id],
      );
      if (rows.length > 0) {
        cursor = Number(rows[0].last_started);
      } else {
        await this.pool.query("delete from member_progress where war_id = $1", [war.id]);
        cursor = war.start;
      }
    }

    const deltas = new Map<number, { name: string; hits: number; score: number }>();
    let from = cursor;
    let lastStarted = cursor;
    for (let page = 0; page < 40; page++) {
      const attacks = await fetchFactionAttacks(client, { from, sort: "ASC", limit: 100 });
      if (attacks.length === 0) break;
      for (const a of attacks) {
        lastStarted = Math.max(lastStarted, a.started);
        // Scoring war hits only: is_ranked_war + positive respect (excludes
        // assists/misses/losses). Validated to within ±1-2 of the official
        // rankedwarreport hit counts.
        if (!a.isRankedWar || a.respectGain <= 0) continue;
        if (a.attackerFactionId !== factionId || a.attackerId == null) continue;
        if (a.started < war.start) continue;
        const d = deltas.get(a.attackerId) ?? { name: a.attackerName ?? `#${a.attackerId}`, hits: 0, score: 0 };
        d.hits += 1;
        d.score += a.respectGain;
        deltas.set(a.attackerId, d);
      }
      if (attacks.length < 100) break;
      from = lastStarted + 1; // next page: strictly after the last seen attack
    }
    this.cursors.set(war.id, lastStarted);
    // Persist the cursor so a restart resumes here instead of rebuilding.
    await this.pool.query(
      `insert into war_cursors (war_id, faction_id, last_started, updated_at)
       values ($1, $2, $3, now())
       on conflict (war_id) do update set last_started = excluded.last_started, updated_at = now()`,
      [war.id, factionId, lastStarted],
    );

    if (deltas.size > 0) {
      const vals: unknown[] = [];
      const tuples: string[] = [];
      let i = 0;
      for (const [memberId, d] of deltas) {
        const o = i * 6;
        vals.push(factionId, war.id, memberId, d.name, d.hits, d.score);
        tuples.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6})`);
        i++;
      }
      await this.pool.query(
        `insert into member_progress (faction_id, war_id, member_id, name, attacks, score)
         values ${tuples.join(",")}
         on conflict (war_id, member_id) do update set
           name = excluded.name,
           attacks = member_progress.attacks + excluded.attacks,
           score = member_progress.score + excluded.score,
           updated_at = now()`,
        vals,
      );
    }

    await this.recomputeBlocked(war.id, factionBlocked, rules);
  }

  /** Recompute blocked + reasons for every member of a war from current totals. */
  private async recomputeBlocked(warId: number, factionBlocked: boolean, rules: WarRules): Promise<void> {
    await this.pool.query(
      `update member_progress set
         blocked = ($2::bool or ($3::int > 0 and score >= $3) or ($4::int > 0 and attacks >= $4)),
         reasons = (
           (case when $2::bool then '["faction_target"]'::jsonb else '[]'::jsonb end)
           || (case when $3::int > 0 and score >= $3 then '["member_score"]'::jsonb else '[]'::jsonb end)
           || (case when $4::int > 0 and attacks >= $4 then '["attack_limit"]'::jsonb else '[]'::jsonb end)
         ),
         updated_at = now()
       where war_id = $1`,
      [warId, factionBlocked, rules.perMemberScoreTarget, rules.maxAttacksPerMember],
    );
  }

  /** Mark a faction's war state inactive when no war is live. */
  async clear(factionId: FactionId): Promise<void> {
    await this.pool.query(
      `update war_state set active = false, enlisted = false, faction_blocked = false, updated_at = now()
       where faction_id = $1 and active = true`,
      [factionId],
    );
  }
}
