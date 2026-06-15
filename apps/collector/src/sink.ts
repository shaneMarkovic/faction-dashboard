/**
 * Persistence sink — where collected snapshots get written.
 *
 * The collector writes through this interface so we can run with a console sink
 * today (no DB needed) and drop in a Supabase sink the moment a connection
 * string lands — without touching the pollers. The Supabase impl will use the
 * service role to upsert into the tables defined in supabase/migrations.
 */

import type {
  ChainSnapshot,
  FactionBalance,
  Member,
  MemberBalance,
  OcCrime,
  RankedWar,
} from "@torn/shared";

export interface Sink {
  writeMembers(members: Member[]): Promise<void>;
  writeChain(chain: ChainSnapshot): Promise<void>;
  writeCrimes(crimes: OcCrime[]): Promise<void>;
  writeWars(wars: RankedWar[]): Promise<void>;
  writeBalance(balance: FactionBalance): Promise<void>;
  writeMemberBalances(balances: MemberBalance[]): Promise<void>;
}

/** Logs counts only — used until Supabase credentials are wired in. */
export class ConsoleSink implements Sink {
  async writeMembers(m: Member[]): Promise<void> {
    console.log(`[sink] members x${m.length} (faction ${m[0]?.factionId ?? "?"})`);
  }
  async writeChain(c: ChainSnapshot): Promise<void> {
    console.log(`[sink] chain ${c.current}/${c.max} (faction ${c.factionId})`);
  }
  async writeCrimes(c: OcCrime[]): Promise<void> {
    console.log(`[sink] crimes x${c.length} (faction ${c[0]?.factionId ?? "?"})`);
  }
  async writeWars(w: RankedWar[]): Promise<void> {
    console.log(`[sink] wars x${w.length} (faction ${w[0]?.factionId ?? "?"})`);
  }
  async writeBalance(b: FactionBalance): Promise<void> {
    console.log(`[sink] balance ${b.money} (faction ${b.factionId})`);
  }
  async writeMemberBalances(b: MemberBalance[]): Promise<void> {
    console.log(`[sink] member balances x${b.length} (faction ${b[0]?.factionId ?? "?"})`);
  }
}
