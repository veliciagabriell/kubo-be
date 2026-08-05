/**
 * "Is this a real ocean-going cargo ship" filter, using only real AIS
 * fields (ITU-R M.1371 ship-type code + hull length). Excludes tugs,
 * barges, fishing boats, and other harbor craft that will never carry a
 * Japan-bound export container - both are broadcast values, not fabricated.
 *
 * Threshold justification: AIS ship-type codes 70-79 are the standardised
 * "Cargo" category. 80m LOA is a conservative floor for a vessel capable of
 * an international multi-day voyage (harbor tugs/barges are typically well
 * under this; even small feeder container ships are usually well above it).
 * A vessel with unknown type/length is excluded rather than guessed as
 * qualifying.
 */

const CARGO_TYPE_MIN = 70;
const CARGO_TYPE_MAX = 79;
export const MIN_OCEAN_GOING_LENGTH_M = 80;

export interface VesselClassificationInput {
  shipTypeCode: number | null;
  lengthM: number | null;
}

export function isLargeCargoVessel(v: VesselClassificationInput): boolean {
  if (v.shipTypeCode == null || v.lengthM == null) return false;
  return (
    v.shipTypeCode >= CARGO_TYPE_MIN &&
    v.shipTypeCode <= CARGO_TYPE_MAX &&
    v.lengthM >= MIN_OCEAN_GOING_LENGTH_M
  );
}

export const VESSEL_FILTER_JUSTIFICATION =
  `Hanya menampilkan kapal dengan kode tipe AIS "Cargo" (70-79) dan panjang lambung >= ` +
  `${MIN_OCEAN_GOING_LENGTH_M}m - menyaring kapal tunda/tongkang/nelayan yang tidak relevan ` +
  `untuk ekspor ke Jepang. Kapal yang tipenya belum diketahui dari AIS disembunyikan, bukan ditebak.`;
