/**
 * Travel domain knowledge (pure data + classifiers, no I/O).
 *
 * Sourced from the Vegemates "Advanced Travel" guide (accurate as of April
 * 2026) and the Torn wiki. Two things the raw market-margin math can't see:
 *   1. Long-haul destinations cost ENERGY and NERVE on landing, and trips over
 *      ~5h waste energy regen — a real cost the profit/min ranking ignores.
 *   2. Item TYPE changes how trustworthy a run is: drugs & museum-artifact
 *      contraband restock irregularly (not the usual 15-min cycle); weapons &
 *      armor roll random quality on purchase so their listed value isn't real;
 *      plushies/flowers/artifacts carry Museum point value beyond market price.
 *
 * Shared so the web (display + ranking) and any future collector logic agree.
 */

/** The energy bar fills in ~5h, so a round trip longer than this wastes regen. */
export const ENERGY_REGEN_WINDOW_MIN = 300;

/** Per-destination travel cost, keyed by YATA country code. From the guide's
 *  airstrip table (private island + full Excursion perks). Energy/nerve are
 *  intrinsic to the destination — speed perks don't change them. */
export interface TravelCost {
  /** One-way flight time on a private-island airstrip, minutes (reference). */
  airstripMin: number;
  /** Energy deducted on landing abroad. */
  energyLoss: number;
  /** Total nerve consumed by the round trip. */
  nerve: number;
}

export const TRAVEL_COST: Record<string, TravelCost> = {
  mex: { airstripMin: 18, energyLoss: 0, nerve: 8 },
  cay: { airstripMin: 25, energyLoss: 0, nerve: 10 },
  can: { airstripMin: 29, energyLoss: 0, nerve: 12 },
  haw: { airstripMin: 94, energyLoss: 0, nerve: 38 },
  uni: { airstripMin: 111, energyLoss: 0, nerve: 45 },
  arg: { airstripMin: 117, energyLoss: 0, nerve: 47 },
  swi: { airstripMin: 123, energyLoss: 0, nerve: 50 },
  jap: { airstripMin: 158, energyLoss: 5, nerve: 64 },
  chi: { airstripMin: 169, energyLoss: 20, nerve: 68 },
  uae: { airstripMin: 190, energyLoss: 40, nerve: 76 },
  sou: { airstripMin: 208, energyLoss: 55, nerve: 84 },
};

/**
 * Coarse item category derived from the Torn `/torn/items` `type` field.
 * NOTE: "Contraband" is a travel concept, not a Torn type, so we can only
 * identify the museum-artifact subset of it reliably (type "Artifact"); other
 * contraband (e.g. raw materials) classifies as "other".
 */
export type ItemCategory =
  | "plushie"
  | "flower"
  | "drug"
  | "weapon"
  | "armor"
  | "temporary"
  | "artifact"
  | "other";

const WEAPON_TYPES = new Set(["Melee", "Primary", "Secondary", "Defensive"]);

export function classifyItem(type: string | null | undefined): ItemCategory {
  switch (type) {
    case "Plushie":
      return "plushie";
    case "Flower":
      return "flower";
    case "Drug":
      return "drug";
    case "Armor":
      return "armor";
    case "Temporary":
      return "temporary";
    case "Artifact":
      return "artifact";
    default:
      return type && WEAPON_TYPES.has(type) ? "weapon" : "other";
  }
}

/** Redeemable for Museum points, so market margin understates real value. */
export function hasMuseumValue(cat: ItemCategory): boolean {
  return cat === "plushie" || cat === "flower" || cat === "artifact";
}

/** Restocks off the usual 15-min cycle, so arrival forecasts are unreliable. */
export function hasIrregularRestock(cat: ItemCategory): boolean {
  return cat === "drug" || cat === "artifact";
}

/** Random quality rolled on purchase + slow to sell — listed value isn't real. */
export function hasVariableQuality(cat: ItemCategory): boolean {
  return cat === "weapon" || cat === "armor";
}
