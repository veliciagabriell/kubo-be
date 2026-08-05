export interface CapacityEstimate {
  estimatedTeu: number;
  estimatedCapacityCbm: number;
  justification: string;
}

/** Nominal internal volume of one TEU slot, industry-standard figure. */
const CBM_PER_TEU = 33.2;

/**
 * Rough capacity estimate from AIS-broadcast hull dimensions (length overall
 * x beam, from ShipStaticData "Dimension to Bow/Stern/Port/Starboard").
 * TEU ~= (LOA x Beam) / 8.5 is a rule-of-thumb used informally by ship
 * brokers for feeder/sub-Panamax container ships (~+-30-40% accuracy). This
 * is NOT a registry/manufacturer capacity figure - there is no free API that
 * exposes real TEU capacity per vessel, so this estimate (with its
 * justification) is the best available real-data-derived proxy.
 */
export function estimateCapacity(lengthM: number, beamM: number): CapacityEstimate {
  const teu = Math.max(0, (lengthM * beamM) / 8.5);
  const capacityCbm = teu * CBM_PER_TEU;
  return {
    estimatedTeu: Math.round(teu),
    estimatedCapacityCbm: Math.round(capacityCbm * 10) / 10,
    justification:
      `Estimasi kasar dari dimensi kapal (AIS): TEU ≈ (LOA ${lengthM.toFixed(1)}m x ` +
      `Beam ${beamM.toFixed(1)}m) / 8.5 ≈ ${Math.round(teu)} TEU, dikonversi ke ` +
      `${Math.round(capacityCbm)} CBM nominal (${CBM_PER_TEU} CBM/TEU). Rumus rule-of-thumb, ` +
      `akurasi ±30-40%, bukan data resmi registry/galangan kapal.`,
  };
}

export interface FullnessEstimate {
  fullnessPercent: number | null;
  justification: string;
}

/**
 * Cargo-load ("how full") estimate from a vessel's own observed draught
 * range - draught increases with cargo weight, and AIS Type 5 messages
 * broadcast "maximum present static draught" (no capacity/weight field
 * exists in AIS). We calibrate per-vessel from real historical readings
 * rather than a fabricated reference draught, and return null (not a guess)
 * until at least two distinct real readings have been observed.
 */
export function computeFullness(
  minDraughtM: number | null,
  maxDraughtM: number | null,
  lastDraughtM: number | null,
): FullnessEstimate {
  if (
    minDraughtM == null ||
    maxDraughtM == null ||
    lastDraughtM == null ||
    maxDraughtM <= minDraughtM
  ) {
    return {
      fullnessPercent: null,
      justification:
        'insufficient_history: butuh minimal 2 pembacaan draught AIS berbeda dari kapal ini ' +
        'sendiri untuk menghitung rentang muatan (belum bisa diestimasi, bukan 0% atau 100%).',
    };
  }
  const pct = Math.min(
    100,
    Math.max(0, ((lastDraughtM - minDraughtM) / (maxDraughtM - minDraughtM)) * 100),
  );
  return {
    fullnessPercent: Math.round(pct),
    justification:
      `Estimasi dari draught AIS kapal ini sendiri: saat ini ${lastDraughtM.toFixed(2)}m, ` +
      `rentang teramati ${minDraughtM.toFixed(2)}–${maxDraughtM.toFixed(2)}m. ` +
      `Fullness% = (draught_sekarang - draught_min) / (draught_max - draught_min).`,
  };
}
