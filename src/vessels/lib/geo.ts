export type PortCountry = 'ID' | 'JP';

export interface PortZone {
  id: string;
  label: string;
  country: PortCountry;
  center: { lat: number; lon: number };
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

/**
 * Real-world coordinates for the two Indonesian origin ports and the three
 * Japanese port areas KUBO tracks. Bounding boxes are generous approach-area
 * boxes (not just the quay), used both for AISstream.io subscription filters
 * and for local geofence classification of incoming position reports.
 */
export const PORT_ZONES: PortZone[] = [
  {
    id: 'tanjung_emas',
    label: 'Tanjung Emas, Semarang',
    country: 'ID',
    center: { lat: -6.947, lon: 110.421 },
    bbox: { minLat: -7.02, maxLat: -6.88, minLon: 110.35, maxLon: 110.5 },
  },
  {
    id: 'tanjung_perak',
    label: 'Tanjung Perak, Surabaya',
    country: 'ID',
    center: { lat: -7.197, lon: 112.732 },
    bbox: { minLat: -7.28, maxLat: -7.1, minLon: 112.65, maxLon: 112.8 },
  },
  {
    id: 'tokyo_bay',
    label: 'Tokyo / Yokohama',
    country: 'JP',
    center: { lat: 35.5, lon: 139.75 },
    bbox: { minLat: 35.2, maxLat: 35.7, minLon: 139.6, maxLon: 139.95 },
  },
  {
    id: 'nagoya',
    label: 'Nagoya',
    country: 'JP',
    center: { lat: 35.083, lon: 136.881 },
    bbox: { minLat: 34.95, maxLat: 35.15, minLon: 136.8, maxLon: 136.95 },
  },
  {
    id: 'osaka_kobe',
    label: 'Osaka / Kobe',
    country: 'JP',
    center: { lat: 34.7, lon: 135.25 },
    bbox: { minLat: 34.55, maxLat: 34.82, minLon: 135.05, maxLon: 135.45 },
  },
];

export function getPortZone(id: string): PortZone | undefined {
  return PORT_ZONES.find((z) => z.id === id);
}

/** Real, publicly known coordinates of Jepara, Central Java - UMKM furniture cluster this app serves. */
export const JEPARA = { lat: -6.5875, lon: 110.6759 };

export interface OriginPortDistance {
  portId: string;
  label: string;
  distanceFromJeparaKm: number;
}

/**
 * Jepara itself has no container terminal - cargo is trucked to whichever
 * of the two tracked origin ports is closer. Real haversine distance from
 * Jepara's real coordinates to each real port's real coordinates - straight
 * line, not road distance, disclosed as such.
 */
export function originPortDistancesFromJepara(): OriginPortDistance[] {
  const emas = getPortZone('tanjung_emas')!;
  const perak = getPortZone('tanjung_perak')!;
  return [
    { portId: 'tanjung_emas', label: emas.label, distanceFromJeparaKm: Math.round(haversineKm(JEPARA, emas.center)) },
    { portId: 'tanjung_perak', label: perak.label, distanceFromJeparaKm: Math.round(haversineKm(JEPARA, perak.center)) },
  ].sort((a, b) => a.distanceFromJeparaKm - b.distanceFromJeparaKm);
}

export interface EtaEstimate {
  estimatedArrivalDate: string;
  distanceRemainingKm: number;
  speedUsedKn: number;
  speedSource: 'ais_realtime' | 'assumed_average';
  justification: string;
}

/** Documented reference cruising speed for feeder/general-cargo vessels - used only when the real AIS speed is too low to derive an ETA from (docked/anchored/maneuvering). */
const ASSUMED_CARGO_CRUISE_SPEED_KN = 12;
const KM_PER_KNOT_HOUR = 1.852;
const MIN_MEANINGFUL_SPEED_KN = 3;

/**
 * Real-time ETA estimate: real current AIS position -> real distance
 * remaining to the real destination port coordinates, divided by the
 * vessel's real current AIS speed. Naturally gives "near origin = ETA far
 * away" and "near destination = ETA very soon" without any invented data.
 * Falls back to a documented average cruise speed (disclosed) only when the
 * ship is stationary/maneuvering and its real speed can't be used to derive
 * a rate of travel.
 */
export function estimateEtaToPort(
  current: { lat: number; lon: number },
  destinationPortLabel: string,
  speedKn: number | null,
): EtaEstimate | null {
  const destZone = PORT_ZONES.find((z) => z.label === destinationPortLabel && z.country === 'JP');
  if (!destZone) return null;
  return estimateEtaToZone(current, destZone, speedKn);
}

/**
 * Same ETA formula as estimateEtaToPort, but toward one of the tracked
 * Indonesian origin ports instead of a Japan destination - used for vessels
 * detected elsewhere in the region that are still inbound to Tanjung
 * Emas/Tanjung Perak (see guessIndonesianOriginZoneFromText).
 */
export function estimateEtaToOriginPort(
  current: { lat: number; lon: number },
  originPortId: string,
  speedKn: number | null,
): EtaEstimate | null {
  const zone = getPortZone(originPortId);
  if (!zone || zone.country !== 'ID') return null;
  return estimateEtaToZone(current, zone, speedKn);
}

function estimateEtaToZone(
  current: { lat: number; lon: number },
  destZone: PortZone,
  speedKn: number | null,
): EtaEstimate {
  const distanceRemainingKm = Math.round(haversineKm(current, destZone.center));
  const useAssumedSpeed = speedKn == null || speedKn < MIN_MEANINGFUL_SPEED_KN;
  const speedUsedKn = useAssumedSpeed ? ASSUMED_CARGO_CRUISE_SPEED_KN : speedKn;
  const hoursRemaining = distanceRemainingKm / (speedUsedKn * KM_PER_KNOT_HOUR);
  const estimatedArrivalDate = new Date(Date.now() + hoursRemaining * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  return {
    estimatedArrivalDate,
    distanceRemainingKm,
    speedUsedKn,
    speedSource: useAssumedSpeed ? 'assumed_average' : 'ais_realtime',
    justification: useAssumedSpeed
      ? `Estimasi tiba: jarak real ${distanceRemainingKm} km dari posisi AIS terakhir ke ${destZone.label}, ` +
        `dibagi asumsi kecepatan jelajah rata-rata kapal kargo ${ASSUMED_CARGO_CRUISE_SPEED_KN} knot ` +
        `(kecepatan real-time AIS kapal saat ini terlalu rendah/diam untuk dipakai menghitung laju).`
      : `Estimasi tiba: jarak real ${distanceRemainingKm} km dari posisi AIS terakhir ke ${destZone.label}, ` +
        `dibagi kecepatan real-time AIS kapal saat ini (${speedUsedKn.toFixed(1)} knot).`,
  };
}

/** Real straight-line distance from Jepara to a specific origin port label (matched against PORT_ZONES). */
export function distanceFromJeparaToPortLabel(originPortLabel: string): { distanceKm: number; justification: string } | null {
  const zone = PORT_ZONES.find((z) => z.label === originPortLabel && z.country === 'ID');
  if (!zone) return null;
  const distanceKm = Math.round(haversineKm(JEPARA, zone.center));
  return {
    distanceKm,
    justification:
      `Jarak garis lurus (great-circle) real dari Jepara ke ${zone.label}: ${distanceKm} km - bukan jarak jalur darat, ` +
      `hanya estimasi kedekatan karena Jepara sendiri tidak memiliki terminal peti kemas.`,
  };
}

export function findZoneForPosition(lat: number, lon: number): PortZone | undefined {
  return PORT_ZONES.find(
    (z) => lat >= z.bbox.minLat && lat <= z.bbox.maxLat && lon >= z.bbox.minLon && lon <= z.bbox.maxLon,
  );
}

const JAPAN_TEXT_HINTS: { pattern: RegExp; zoneId: string }[] = [
  { pattern: /TOKYO|YOKOHAMA/i, zoneId: 'tokyo_bay' },
  { pattern: /NAGOYA/i, zoneId: 'nagoya' },
  { pattern: /OSAKA|KOBE/i, zoneId: 'osaka_kobe' },
];

/**
 * Best-effort guess of the intended Japan port zone from a vessel's free-text
 * AIS "Destination" field (crew-entered, often messy/abbreviated). Used only
 * as a provisional label before a real geofence arrival confirms it - see
 * DestinationConfidence on the Voyage entity.
 */
export function guessJapanZoneFromText(text: string | null | undefined): PortZone | undefined {
  if (!text) return undefined;
  const hint = JAPAN_TEXT_HINTS.find((h) => h.pattern.test(text));
  return hint ? getPortZone(hint.zoneId) : undefined;
}

const INDONESIA_ORIGIN_TEXT_HINTS: { pattern: RegExp; zoneId: string }[] = [
  { pattern: /TANJUNG\s?EMAS|TG\.?\s?EMAS|SEMARANG/i, zoneId: 'tanjung_emas' },
  { pattern: /TANJUNG\s?PERAK|TG\.?\s?PERAK|SURABAYA/i, zoneId: 'tanjung_perak' },
];

/**
 * Same idea as guessJapanZoneFromText but for the two tracked Indonesian
 * origin ports - used to spot a vessel elsewhere in the region (not yet
 * inside either port's geofence) that has already broadcast Tanjung
 * Emas/Tanjung Perak as its AIS Destination, so it can be surfaced as
 * "inbound" before it physically arrives.
 */
export function guessIndonesianOriginZoneFromText(text: string | null | undefined): PortZone | undefined {
  if (!text) return undefined;
  const hint = INDONESIA_ORIGIN_TEXT_HINTS.find((h) => h.pattern.test(text));
  return hint ? getPortZone(hint.zoneId) : undefined;
}

/** AISstream.io subscription bounding boxes: [[minLat, minLon], [maxLat, maxLon]] per zone. */
export function aisSubscriptionBoundingBoxes(): [[number, number], [number, number]][] {
  return PORT_ZONES.map((z) => [
    [z.bbox.minLat, z.bbox.minLon],
    [z.bbox.maxLat, z.bbox.maxLon],
  ]);
}

/**
 * A single wide bounding box covering Indonesia + maritime Southeast Asia
 * (Sumatra/Java/Kalimantan/Sulawesi, the Malacca/Singapore Strait, the
 * southern South China Sea approaches, and the Makassar/Sunda Strait
 * corridors) - roughly lat -11..15, lon 94..121. Subscribed in ADDITION to
 * the tight per-zone boxes above so vessels still elsewhere in the region,
 * not yet inside a tracked port's geofence, are also picked up (see
 * VesselsService.listInboundVessels / guessIndonesianOriginZoneFromText).
 * Deliberately does not extend further (no full South China Sea north of
 * Vietnam, no open Pacific) to keep AIS message volume bounded to the
 * corridor actually relevant to Indonesia<->Japan cargo routes.
 */
export function aisWideRegionBoundingBox(): [[number, number], [number, number]] {
  return [
    [-11, 94],
    [15, 121],
  ];
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * ITU-R M.1371 "Ship and Cargo type" code ranges broadcast by AIS Type 5
 * messages. Coarse, standardised classification — not container/TEU specific
 * (AIS has no field for that), used only as a human-readable label.
 */
export function aisShipTypeLabel(code: number | null | undefined): string {
  if (code == null) return 'Tidak diketahui';
  if (code >= 70 && code <= 79) return 'Kapal kargo';
  if (code >= 80 && code <= 89) return 'Kapal tanker';
  if (code >= 60 && code <= 69) return 'Kapal penumpang';
  if (code >= 30 && code <= 39) return 'Kapal nelayan/khusus';
  if (code >= 90 && code <= 99) return 'Kapal lainnya';
  return 'Tidak diketahui';
}

export interface MajorPort {
  city: string;
  country: string;
  lat: number;
  lon: number;
}

/**
 * Real, publicly documented coordinates of major ports along the
 * Indonesia<->Japan container shipping corridor. Used only to compute a
 * "nearest major port" label from a vessel's real AIS position - not a
 * precise location, just a real, disclosed distance to a real reference
 * point (see estimateLocationLabel).
 */
export const MAJOR_PORTS: MajorPort[] = [
  { city: 'Tanjung Emas, Semarang', country: 'Indonesia', lat: -6.947, lon: 110.421 },
  { city: 'Tanjung Perak, Surabaya', country: 'Indonesia', lat: -7.197, lon: 112.732 },
  { city: 'Tanjung Priok, Jakarta', country: 'Indonesia', lat: -6.1, lon: 106.88 },
  { city: 'Singapura', country: 'Singapura', lat: 1.29, lon: 103.85 },
  { city: 'Ho Chi Minh City', country: 'Vietnam', lat: 10.76, lon: 106.76 },
  { city: 'Manila', country: 'Filipina', lat: 14.58, lon: 120.97 },
  { city: 'Hong Kong', country: 'Hong Kong', lat: 22.3, lon: 114.17 },
  { city: 'Kaohsiung', country: 'Taiwan', lat: 22.61, lon: 120.28 },
  { city: 'Shanghai', country: 'Tiongkok', lat: 31.23, lon: 121.47 },
  { city: 'Ningbo-Zhoushan', country: 'Tiongkok', lat: 29.87, lon: 121.55 },
  { city: 'Busan', country: 'Korea Selatan', lat: 35.1, lon: 129.04 },
  { city: 'Tokyo / Yokohama', country: 'Jepang', lat: 35.5, lon: 139.75 },
  { city: 'Nagoya', country: 'Jepang', lat: 35.083, lon: 136.881 },
  { city: 'Osaka / Kobe', country: 'Jepang', lat: 34.7, lon: 135.25 },
];

export interface EstimatedLocation {
  city: string;
  country: string;
  approxDistanceKm: number;
  justification: string;
}

/**
 * Best-effort "where is this ship roughly" label from real AIS lat/lon -
 * never the raw coordinates themselves. Finds the nearest real, publicly
 * documented major port and reports the real great-circle distance to it.
 * Intentionally NOT precise - it's an honest approximation, not a fabricated
 * city name.
 */
export function estimateLocationLabel(lat: number, lon: number): EstimatedLocation {
  let nearest = MAJOR_PORTS[0];
  let minDistanceKm = haversineKm({ lat, lon }, { lat: nearest.lat, lon: nearest.lon });
  for (const port of MAJOR_PORTS.slice(1)) {
    const distanceKm = haversineKm({ lat, lon }, { lat: port.lat, lon: port.lon });
    if (distanceKm < minDistanceKm) {
      minDistanceKm = distanceKm;
      nearest = port;
    }
  }
  const approxDistanceKm = Math.round(minDistanceKm);
  return {
    city: nearest.city,
    country: nearest.country,
    approxDistanceKm,
    justification:
      `Perkiraan lokasi, bukan koordinat presisi: dihitung dari jarak great-circle real ` +
      `(${approxDistanceKm} km) antara posisi GPS asli kapal (AIS) dan pelabuhan besar terdekat ` +
      `yang diketahui (${nearest.city}, ${nearest.country}).`,
  };
}
