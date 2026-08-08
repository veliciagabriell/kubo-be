import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Vessel } from '../vessels/entities/vessel.entity';
import { Voyage, VoyageStatus } from '../vessels/entities/voyage.entity';
import {
  distanceFromJeparaToPortLabel,
  estimateEtaToOriginPort,
  estimateEtaToPort,
  estimateLocationLabel,
  EstimatedLocation,
  EtaEstimate,
  getPortZone,
  guessJapanZoneFromText,
  haversineKm,
  JEPARA,
  originPortDistancesFromJepara,
} from '../vessels/lib/geo';
import { isLargeCargoVessel } from '../vessels/lib/vessel-classification';
import type { VoyageEventPayload } from '../vessels/voyage-detection.service';
import { AiMatchCandidate, AiMatchingService } from './ai-matching.service';
import { Container, ContainerType } from './entities/container.entity';
import { MatchRequestDto } from './dto/match-request.dto';

export interface CostBreakdownView {
  freight: number;
  platformFee: number;
  documentAssistance: number;
  handling: number;
  insurance: number;
  taxes: number;
  subscription: number;
  total: number;
}

export interface ContainerVesselView {
  mmsi: string;
  dataSource: 'live_ais' | 'development_fixture';
  imo: string | null;
  name: string | null;
  shipTypeLabel: string | null;
  estimatedTeu: number | null;
  estimatedCapacityCbm: number | null;
  capacityEstimateJustification: string | null;
  lastDraughtM: number | null;
  fullnessPercent: number | null;
  fullnessJustification: string | null;
  /** When the fullness/capacity fields were last refreshed from a real AIS ShipStaticData message - distinct from position updates. */
  fullnessUpdatedAt: Date | null;
  estimatedLocation: EstimatedLocation | null;
  /** Vessel's own self-reported ETA (AIS Type 5 Eta field) - real broadcast data, no year, crew-entered. */
  lastEtaRaw: string | null;
  lastPositionAt: Date | null;
}

export interface ContainerMatchView extends Container {
  shipmentType: 'Consolidated LCL';
  estimatedDeparture: string;
  cargoCutoff: string | null;
  documentCutoff: string | null;
  occupancy: number;
  remainingCbm: number;
  participants: number;
  matchStatus: string;
  vessel: ContainerVesselView | null;
  /** Real straight-line distance from Jepara to this container's origin port - null if the origin port label doesn't match a tracked zone. */
  originPortDistanceFromJeparaKm: number | null;
  originPortDistanceJustification: string | null;
  /** Real-time ETA estimate from the vessel's current AIS position - null once arrived (real transitDays takes over) or if destination/position isn't known yet. */
  estimatedArrivalInJapan: string | null;
  estimatedArrivalJustification: string | null;
  costs: CostBreakdownView;
}

export interface ScoredContainer extends ContainerMatchView {
  availableCbm: number;
  utilizationPercent: number;
  matchScore: number;
  scoreBreakdown: {
    utilizationScore: number;
    dateProximityScore: number;
    collaborationScore: number;
    fitRatioScore: number;
  };
  /** Real day count between this container's real departureDate and the requested preferredDate. Positive = departs after preferredDate. */
  daysFromPreferredDate: number;
  /** AI compatibility score (0-1) - null when the AI layer is disabled or failed. */
  aiScore: number | null;
  /** Short AI-generated rationale in Indonesian - null when aiScore is null. */
  aiRationale: string | null;
  /** Final ranking score actually used to sort - blended with AI when available, matchScore otherwise. */
  finalScore: number;
  finalScoreJustification: string;
}

/**
 * Freight-forwarder cost estimate. There is no free API that exposes a real
 * forwarder's quoted rate for a specific vessel/voyage (that's a private
 * commercial booking, not broadcast data, and carriers like Maersk require a
 * direct account/quote request - checked, no public rate API exists) - so
 * this stays a transparent, justified formula over REAL port-to-port
 * distance. Calibrated to sit inside a real, published 2026 industry LCL
 * benchmark range of USD 40-180/CBM (general ocean freight market research,
 * short/medium intra-Asia lanes like Indonesia-Japan trend toward the lower
 * half of that range) - not a fabricated number. Always labelled as an
 * estimate; never presented as a live quote. The KUBO platform fee
 * (Rp 500/CBM, in buildCosts below) is separate and real/fixed, not an estimate.
 */
const FREIGHT_BASE_RATE_IDR_PER_CBM = 400_000;
const FREIGHT_RATE_IDR_PER_CBM_PER_KM = 150;
const REFERENCE_USD_TO_IDR = 16_000;
const INDUSTRY_LCL_RANGE_USD_PER_CBM = { min: 40, max: 180 };

function estimateFreightCost(
  originPortId: string,
  destinationPortId: string | null,
) {
  const origin = getPortZone(originPortId);
  const destination = destinationPortId
    ? getPortZone(destinationPortId)
    : undefined;
  if (!origin || !destination) {
    return {
      costPerCbm: FREIGHT_BASE_RATE_IDR_PER_CBM,
      justification:
        'Tujuan di Jepang belum terkonfirmasi dari AIS (kapal belum terdeteksi mendekati salah ' +
        'satu pelabuhan tujuan) - estimasi memakai tarif dasar saja dan akan diperbarui begitu ' +
        'tujuan terkonfirmasi.',
    };
  }
  const distanceKm = Math.round(haversineKm(origin.center, destination.center));
  const costPerCbm = Math.round(
    FREIGHT_BASE_RATE_IDR_PER_CBM +
      FREIGHT_RATE_IDR_PER_CBM_PER_KM * distanceKm,
  );
  const costPerCbmUsd = Math.round(costPerCbm / REFERENCE_USD_TO_IDR);
  return {
    costPerCbm,
    justification:
      `Estimasi biaya freight forwarder (BUKAN tarif resmi dari carrier tertentu seperti Maersk - ` +
      `tidak ada API gratis untuk tarif per kapal/voyage, hanya bisa didapat lewat request kuotasi ` +
      `langsung ke carrier/forwarder): Rp${FREIGHT_BASE_RATE_IDR_PER_CBM.toLocaleString('id-ID')}/CBM ` +
      `dasar + Rp${FREIGHT_RATE_IDR_PER_CBM_PER_KM}/CBM per km x jarak nyata ${origin.label} -> ` +
      `${destination.label} (${distanceKm} km, dihitung dari koordinat pelabuhan) = ` +
      `Rp${costPerCbm.toLocaleString('id-ID')}/CBM (~USD ${costPerCbmUsd}/CBM). Berada dalam rentang ` +
      `tarif LCL umum industri 2026 (USD ${INDUSTRY_LCL_RANGE_USD_PER_CBM.min}-${INDUSTRY_LCL_RANGE_USD_PER_CBM.max}/CBM ` +
      `menurut riset pasar logistik) untuk rute jarak sedang seperti Indonesia-Jepang.`,
  };
}

/** Only the top N MCDA candidates are sent to the AI layer - keeps latency/cost bounded. */
const AI_RERANK_TOP_N = 5;
/** Weight given to the AI compatibility score in the final blend; the rest is the real-data MCDA score. */
const AI_BLEND_WEIGHT = 0.4;

@Injectable()
export class MatchingService implements OnModuleInit {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @InjectRepository(Container)
    private readonly containerRepo: Repository<Container>,
    @InjectRepository(Vessel)
    private readonly vesselRepo: Repository<Vessel>,
    @InjectRepository(Voyage)
    private readonly voyageRepo: Repository<Voyage>,
    private readonly aiMatchingService: AiMatchingService,
  ) {}

  /**
   * One-time reconciliation on startup: a still-open INBOUND or
   * AWAITING_DEPARTURE voyage can exist without a Container if its vessel's
   * AIS static data (type/length) or position arrived after `voyage.created`
   * fired (see syncAwaitingVoyage/syncInboundVoyage/handleVesselStaticDataUpdated)
   * - this catches up any such voyage using whatever vessel data is already
   * known right now, instead of waiting for the next live AIS message.
   */
  async onModuleInit() {
    const openVoyages = await this.voyageRepo.find({
      where: [
        { status: VoyageStatus.INBOUND },
        { status: VoyageStatus.AWAITING_DEPARTURE },
      ],
    });
    let synced = 0;
    for (const voyage of openVoyages) {
      const existing = await this.containerRepo.findOneBy({
        voyageId: voyage.id,
      });
      if (existing) continue;
      const vessel = await this.vesselRepo.findOneBy({
        mmsi: voyage.vesselMmsi,
      });
      if (
        !isLargeCargoVessel({
          shipTypeCode: vessel?.shipTypeCode ?? null,
          lengthM: vessel?.lengthM ?? null,
        })
      ) {
        continue;
      }
      if (voyage.status === VoyageStatus.INBOUND) {
        await this.syncInboundVoyage(voyage, vessel ?? undefined);
      } else {
        await this.syncAwaitingVoyage(voyage);
      }
      synced++;
    }
    if (synced) {
      this.logger.log(
        `Reconciled ${synced} already-open voyage(s) into containers on startup`,
      );
    }
  }

  /**
   * KUBO Smart Container Matching Algorithm
   *
   * Hybrid pendekatan dua lapis:
   *
   * LAPIS 1 - Weighted Multi-Criteria Decision Analysis (MCDA), terinspirasi
   * dari metode TOPSIS (Technique for Order of Preference by Similarity to
   * Ideal Solution). Deterministik, semua berbasis data nyata:
   * 1. Utilization Score (40%) - seberapa optimal container terisi setelah
   *    ditambah muatan user, dihitung dari currentUsedCbm (booking nyata di
   *    OrdersService) / totalCapacityCbm (konstanta ISO container). Target
   *    optimal = 85% kapasitas.
   * 2. Date Proximity Score (35%) - seberapa dekat tanggal keberangkatan
   *    dengan preferensi user. departureDate berasal dari waktu keberangkatan
   *    NYATA kapal (dikonfirmasi via AIS/AISstream.io), bukan jadwal seed.
   * 3. Collaboration Score (15%) - bonus jika sudah ada banyak UMKM lain
   *    yang bergabung (umkmCount = jumlah booking nyata di platform).
   * 4. Fit Ratio Score (10%) - seberapa pas volume user mengisi sisa ruang.
   *    Final Score = 0.40×U + 0.35×D + 0.15×C + 0.10×F  ∈ [0, 1]
   *
   * LAPIS 2 - AI re-ranking (Google Gemini gratis secara default, atau
   * Claude jika ANTHROPIC_API_KEY diset - lihat AiMatchingService). Mengapa
   * bukan model ML yang dilatih sendiri: KUBO belum punya data historis
   * hasil matching nyata untuk dijadikan label training - melatih model
   * sendiri sekarang berarti memakai label palsu/rekayasa, yang melanggar
   * aturan "no fabricated data". Sebagai gantinya, model AI yang sudah
   * terlatih (bukan hasil training kami) diberi HANYA data nyata (kapal,
   * muatan, jadwal) untuk 5 kandidat teratas dari Lapis 1, dan diminta
   * menilai kecocokan kualitatif (mis. jenis kapal vs kebutuhan kargo) yang
   * tidak tertangkap rumus numerik. Final Score = (1-0.4)×MCDA + 0.4×AI
   * ketika AI aktif; jika tidak ada API key AI yang diset, sistem otomatis
   * fallback ke skor MCDA murni (graceful degrade, sama seperti AIS).
   */
  async findMatches(dto: MatchRequestDto): Promise<ScoredContainer[]> {
    const containers = await this.containerRepo.find({
      where: { destinationCountry: dto.destinationCountry, status: 'open' },
    });

    const preferredDate = new Date(dto.preferredDate);

    const scored: ScoredContainer[] = [];

    for (const c of containers) {
      const available = c.totalCapacityCbm - c.currentUsedCbm;
      if (available < dto.volumeCbm) continue;

      const scoreBreakdown = this.calculateScoreBreakdown(
        c,
        dto.volumeCbm,
        preferredDate,
      );
      const matchScore =
        0.4 * scoreBreakdown.utilizationScore +
        0.35 * scoreBreakdown.dateProximityScore +
        0.15 * scoreBreakdown.collaborationScore +
        0.1 * scoreBreakdown.fitRatioScore;

      const utilizationPercent = Math.round(
        ((c.currentUsedCbm + dto.volumeCbm) / c.totalCapacityCbm) * 100,
      );
      const daysFromPreferredDate = Math.round(
        (new Date(c.departureDate).getTime() - preferredDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      scored.push({
        ...(await this.toMatchView(c, dto.volumeCbm)),
        availableCbm: parseFloat(available.toFixed(2)),
        utilizationPercent,
        daysFromPreferredDate,
        matchScore: parseFloat(matchScore.toFixed(4)),
        scoreBreakdown: {
          utilizationScore: parseFloat(
            scoreBreakdown.utilizationScore.toFixed(4),
          ),
          dateProximityScore: parseFloat(
            scoreBreakdown.dateProximityScore.toFixed(4),
          ),
          collaborationScore: parseFloat(
            scoreBreakdown.collaborationScore.toFixed(4),
          ),
          fitRatioScore: parseFloat(scoreBreakdown.fitRatioScore.toFixed(4)),
        },
        aiScore: null,
        aiRationale: null,
        finalScore: parseFloat(matchScore.toFixed(4)),
        finalScoreJustification: this.aiMatchingService.enabled
          ? 'Skor MCDA (lapis AI aktif, tapi kandidat ini di luar 5 teratas sehingga tidak dikirim ke AI).'
          : 'Skor MCDA murni (lapis AI tidak aktif - tidak ada API key AI yang diset).',
      });
    }

    scored.sort((a, b) => b.matchScore - a.matchScore);
    await this.applyAiReranking(scored, dto);
    return scored.sort((a, b) => b.finalScore - a.finalScore);
  }

  private calculateScoreBreakdown(
    container: Container,
    requestedCbm: number,
    preferredDate: Date,
  ) {
    const available = container.totalCapacityCbm - container.currentUsedCbm;
    const newUtilization =
      (container.currentUsedCbm + requestedCbm) / container.totalCapacityCbm;

    // 1. Utilization Score – optimal di 85%
    const OPTIMAL = 0.85;
    const utilizationScore = Math.max(
      0,
      1 - Math.abs(newUtilization - OPTIMAL) / OPTIMAL,
    );

    // 2. Date Proximity Score – window 30 hari
    const departureDays =
      Math.abs(
        new Date(container.departureDate).getTime() - preferredDate.getTime(),
      ) /
      (1000 * 60 * 60 * 24);
    const dateProximityScore = Math.max(0, 1 - departureDays / 30);

    // 3. Collaboration Score – makin banyak UMKM bergabung makin bagus (max 5)
    const collaborationScore = Math.min(1, container.umkmCount / 5);

    // 4. Fit Ratio – seberapa pas muatan user mengisi sisa ruang
    const fitRatioScore = Math.min(1, requestedCbm / available);

    return {
      utilizationScore,
      dateProximityScore,
      collaborationScore,
      fitRatioScore,
    };
  }

  /**
   * Sends only the top AI_RERANK_TOP_N MCDA candidates (real data only - no
   * fabricated product fields) to the active AI provider, then blends the returned
   * compatibility score into finalScore. No-ops (leaves MCDA-only
   * finalScore) if the AI layer is disabled or the call fails.
   */
  private async applyAiReranking(
    scored: ScoredContainer[],
    dto: MatchRequestDto,
  ) {
    if (!this.aiMatchingService.enabled || scored.length === 0) return;
    const topCandidates = scored.slice(0, AI_RERANK_TOP_N);
    const aiCandidates: AiMatchCandidate[] = topCandidates.map((c) => ({
      containerId: c.id,
      destinationCity: c.destinationCity,
      vesselName: c.vessel?.name ?? null,
      vesselType: c.vessel?.shipTypeLabel ?? null,
      departureDate: c.departureDate,
      occupancyPercent: c.occupancy,
      remainingCbm: c.remainingCbm,
      requestedCbm: dto.volumeCbm,
      fullnessPercent: c.vessel?.fullnessPercent ?? null,
      mcdaScore: c.matchScore,
    }));

    const results = await this.aiMatchingService.scoreCandidates(aiCandidates, {
      volumeCbm: dto.volumeCbm,
      preferredDate: dto.preferredDate,
    });
    if (!results) {
      // AI was enabled but the call failed (e.g. quota, transient error) - be
      // explicit that this is a real failure, not "AI never configured".
      for (const c of topCandidates) {
        c.finalScoreJustification =
          'Skor MCDA murni (panggilan API AI gagal saat permintaan ini - fallback otomatis, lihat log server).';
      }
      return;
    }

    const byId = new Map(results.map((r) => [r.containerId, r]));
    for (const c of topCandidates) {
      const aiResult = byId.get(c.id);
      if (!aiResult) continue;
      c.aiScore = aiResult.aiScore;
      c.aiRationale = aiResult.rationale;
      c.finalScore = parseFloat(
        (
          (1 - AI_BLEND_WEIGHT) * c.matchScore +
          AI_BLEND_WEIGHT * aiResult.aiScore
        ).toFixed(4),
      );
      const providerLabel =
        this.aiMatchingService.activeProvider === 'gemini'
          ? 'Google Gemini'
          : 'Claude';
      c.finalScoreJustification =
        `Blend: ${((1 - AI_BLEND_WEIGHT) * 100).toFixed(0)}% skor MCDA (${c.matchScore.toFixed(4)}) + ` +
        `${(AI_BLEND_WEIGHT * 100).toFixed(0)}% skor kompatibilitas AI ${providerLabel} (${aiResult.aiScore.toFixed(4)}).`;
    }
  }

  /**
   * Real logistics info for UMKM shipping out of Jepara (which itself has no
   * container terminal): straight-line distance from Jepara to each tracked
   * origin port, and which one is closer. Static real geography - no AIS
   * dependency, always available.
   */
  getOriginPortsInfo() {
    const distances = originPortDistancesFromJepara();
    const nearest = distances[0];
    return {
      jepara: JEPARA,
      distances,
      recommended: nearest,
      justification:
        `Jepara tidak memiliki terminal peti kemas sendiri, sehingga kargo perlu diangkut ke ` +
        `${nearest.label} (±${nearest.distanceFromJeparaKm} km dari Jepara, garis lurus) sebagai ` +
        `pelabuhan asal terdekat. Jarak dihitung dari koordinat nyata Jepara dan pelabuhan.`,
    };
  }

  async getAllContainers(forCbm = 5): Promise<ContainerMatchView[]> {
    const containers = await this.containerRepo.find({
      where: { status: In(['open', 'full']) },
      order: { departureDate: 'ASC' },
    });
    return Promise.all(containers.map((c) => this.toMatchView(c, forCbm)));
  }

  async getContainerById(id: string, forCbm = 5): Promise<ContainerMatchView> {
    const container = await this.containerRepo.findOneBy({ id });
    if (!container) throw new NotFoundException('Container not found');
    return this.toMatchView(container, forCbm);
  }

  async getAlgorithmInfo() {
    const provider = this.aiMatchingService.activeProvider;
    const fixtureEnabled =
      ['1', 'true', 'yes', 'on'].includes(
        (process.env.MATCHING_FIXTURE_ENABLED ?? '').trim().toLowerCase(),
      ) &&
      ['development', 'test'].includes(
        (process.env.APP_ENV ?? '').trim().toLowerCase(),
      );
    const providerLabel =
      provider === 'gemini'
        ? 'Google Gemini (gratis)'
        : provider === 'claude'
          ? 'Claude'
          : 'tidak aktif';
    return {
      name: 'KUBO Smart Container Matching',
      method:
        'Hybrid: Weighted Multi-Criteria Decision Analysis (W-MCDA / TOPSIS-inspired) + ' +
        `lapis re-ranking AI (${providerLabel}${this.aiMatchingService.activeModel ? `, ${this.aiMatchingService.activeModel}` : ''})`,
      aiLayer: {
        enabled: this.aiMatchingService.enabled,
        provider,
        model: this.aiMatchingService.activeModel,
        appliesTo: `${AI_RERANK_TOP_N} kandidat teratas hasil lapis MCDA saja (bukan seluruh daftar, untuk membatasi biaya/latensi)`,
        blendFormula: `finalScore = ${1 - AI_BLEND_WEIGHT}×mcdaScore + ${AI_BLEND_WEIGHT}×aiScore`,
        whyNotTrainedModel:
          'KUBO belum memiliki data historis hasil matching nyata untuk dijadikan label training - ' +
          'melatih model sendiri sekarang berarti memakai label palsu, yang melanggar aturan tanpa data ' +
          'fabrikasi. Sebagai gantinya digunakan model AI yang sudah terlatih (bukan hasil training kami), ' +
          'diberi hanya data nyata (kapal, muatan, jadwal) untuk menilai kecocokan kualitatif.',
        providerChoice:
          'Default: Google Gemini (GEMINI_API_KEY) - tier gratis, tanpa kartu kredit, dari ' +
          'aistudio.google.com/apikey. Claude (ANTHROPIC_API_KEY) dipakai hanya jika Gemini tidak diset.',
        fallback:
          'Jika tidak ada API key AI yang diset, atau panggilan API gagal, sistem otomatis kembali ke skor MCDA murni (graceful degrade).',
      },
      developmentFixture: {
        enabled: fixtureEnabled,
        dataSource: 'development_fixture',
        warning: fixtureEnabled
          ? 'Mode development aktif; kandidat berlabel development_fixture bukan data AIS live.'
          : null,
      },
      description:
        'Menggabungkan 4 kriteria penilaian MCDA untuk menemukan container paling optimal bagi ' +
        `muatan UMKM, lalu 5 kandidat teratas dinilai ulang oleh AI (${providerLabel}) untuk kecocokan kualitatif. ` +
        (fixtureEnabled
          ? 'Mode development fixture sedang aktif agar alur dapat diuji saat AISstream bermasalah; periksa dataSource pada setiap kandidat.'
          : 'Container hanya muncul setelah kapal aslinya terdeteksi via AIS live (AISstream.io).'),
      criteria: [
        {
          name: 'Utilization Score',
          weight: 0.4,
          description:
            'Seberapa optimal penggunaan container setelah ditambah volume user. Target 85% kapasitas.',
          formula: 'max(0, 1 - |utilization_baru - 0.85| / 0.85)',
          dataSource:
            'currentUsedCbm: booking nyata (Orders); totalCapacityCbm: konstanta ISO container',
        },
        {
          name: 'Date Proximity Score',
          weight: 0.35,
          description:
            'Kedekatan tanggal keberangkatan dengan preferensi user (window 30 hari).',
          formula: 'max(0, 1 - |selisih_hari| / 30)',
          dataSource:
            'departureDate: waktu keberangkatan nyata kapal, dikonfirmasi via AIS',
        },
        {
          name: 'Collaboration Score',
          weight: 0.15,
          description:
            'Bonus untuk container yang sudah memiliki banyak UMKM bergabung (cost sharing efisien).',
          formula: 'min(1, umkm_count / 5)',
          dataSource: 'umkmCount: jumlah booking nyata di platform (Orders)',
        },
        {
          name: 'Fit Ratio Score',
          weight: 0.1,
          description:
            'Seberapa pas volume muatan user mengisi sisa ruang yang tersedia.',
          formula: 'min(1, requested_cbm / available_cbm)',
          dataSource:
            'available_cbm: totalCapacityCbm - currentUsedCbm (keduanya nyata)',
        },
      ],
      finalFormula: 'MCDA Score = 0.40×U + 0.35×D + 0.15×C + 0.10×F',
      scoreRange: '[0, 1] – semakin mendekati 1 semakin optimal',
      dataProvenanceNote:
        (fixtureEnabled
          ? 'Fixture development selalu ditandai dataSource=development_fixture dan tidak boleh diperlakukan sebagai data AIS. '
          : '') +
        'Field yang bersifat estimasi (bukan data AIS/DB langsung) selalu disertai field ' +
        '*Justification yang menjelaskan formula dan input aslinya - lihat costs.freight ' +
        '(freightEstimateJustification), vessel.estimatedTeu (capacityEstimateJustification), ' +
        'vessel.fullnessPercent (fullnessJustification), estimatedArrivalInJapan ' +
        '(estimatedArrivalJustification), dan departureDate ketika departureConfirmed=false ' +
        '(departureEstimateJustification - kapal terdeteksi dekat pelabuhan asal tapi belum ' +
        'terkonfirmasi berangkat; akan otomatis diperbarui ke tanggal nyata begitu keberangkatan ' +
        'terdeteksi via AIS).',
    };
  }

  /** Real port-to-port distance x KUBO's real fixed Rp 500/CBM service charge; see estimateFreightCost. */
  private buildCosts(container: Container, cbm: number): CostBreakdownView {
    const freight = Math.round(container.costPerCbm * cbm);
    const platformFee = Math.round(cbm * 500); // KUBO's real, fixed service charge - not an estimate
    const documentAssistance = 0;
    const handling = 0;
    const insurance = 0;
    const taxes = 0;
    const subscription = 0;
    const total =
      freight +
      platformFee +
      documentAssistance +
      handling +
      insurance +
      taxes +
      subscription;
    return {
      freight,
      platformFee,
      documentAssistance,
      handling,
      insurance,
      taxes,
      subscription,
      total,
    };
  }

  private cutoffs(departureDate: string): { cargo: string; document: string } {
    const departure = new Date(departureDate);
    const cargo = new Date(departure);
    cargo.setDate(cargo.getDate() - 5);
    const doc = new Date(departure);
    doc.setDate(doc.getDate() - 7);
    return {
      cargo: cargo.toISOString().slice(0, 10),
      document: doc.toISOString().slice(0, 10),
    };
  }

  private async toMatchView(
    container: Container,
    cbmForCost: number,
  ): Promise<ContainerMatchView> {
    const occupancy = Math.round(
      (container.currentUsedCbm / container.totalCapacityCbm) * 100,
    );
    const remainingCbm = parseFloat(
      (container.totalCapacityCbm - container.currentUsedCbm).toFixed(2),
    );
    const vessel = await this.vesselRepo.findOneBy({
      mmsi: container.vesselMmsi,
    });
    const jeparaDistance = distanceFromJeparaToPortLabel(container.originPort);

    // Real-time ETA: only meaningful before real arrival (status !== 'closed'),
    // and only when we have both a real current position and a resolved JP destination.
    let eta: EtaEstimate | null = null;
    if (
      container.status !== 'closed' &&
      vessel?.lastLat != null &&
      vessel?.lastLon != null
    ) {
      eta = estimateEtaToPort(
        { lat: vessel.lastLat, lon: vessel.lastLon },
        container.destinationCity,
        vessel.lastSpeedKn,
      );
    }

    // Real-time "ready to load" refinement: while the vessel hasn't actually
    // departed yet, recompute how long it still needs to reach the origin
    // port from its CURRENT position (distance/speed) rather than trusting
    // the value stored at creation time, which only reflects where the
    // vessel was back then. Only overrides when the fresh ETA lands strictly
    // after today - a vessel already at/near the port still correctly keeps
    // its stored "ready today" estimate and justification (see
    // syncAwaitingVoyage/syncArrivedAtOrigin), instead of every UMKM being
    // shown "ready today" for a ship that may still be days away and giving
    // them no real lead time to get cargo to the dock.
    let estimatedDeparture = container.departureDate;
    let departureEstimateJustification =
      container.departureEstimateJustification;
    if (
      !container.departureConfirmed &&
      container.originPortId &&
      vessel?.lastLat != null &&
      vessel?.lastLon != null
    ) {
      const originEta = estimateEtaToOriginPort(
        { lat: vessel.lastLat, lon: vessel.lastLon },
        container.originPortId,
        vessel.lastSpeedKn,
      );
      const today = new Date().toISOString().slice(0, 10);
      if (originEta && originEta.estimatedArrivalDate > today) {
        estimatedDeparture = originEta.estimatedArrivalDate;
        departureEstimateJustification =
          `${originEta.justification} Ini estimasi TIBA kapal di ${container.originPort} dari posisi AIS-nya ` +
          `saat ini (bukan tanggal keberangkatan dari Jepang) - begitu kapal tiba, kargo Anda perlu sudah ` +
          `berada di pelabuhan sebelum tanggal tersebut agar sempat dimuat.`;
      }
    }

    return {
      ...container,
      shipmentType: 'Consolidated LCL',
      estimatedDeparture,
      departureDate: estimatedDeparture,
      departureEstimateJustification,
      cargoCutoff: container.cargoCutoffDate,
      documentCutoff: container.documentCutoffDate,
      occupancy,
      remainingCbm,
      participants: container.umkmCount,
      matchStatus: this.deriveMatchStatus(container, occupancy),
      originPortDistanceFromJeparaKm: jeparaDistance?.distanceKm ?? null,
      originPortDistanceJustification: jeparaDistance?.justification ?? null,
      estimatedArrivalInJapan: eta?.estimatedArrivalDate ?? null,
      estimatedArrivalJustification: eta?.justification ?? null,
      vessel: vessel
        ? {
            mmsi: vessel.mmsi,
            dataSource: vessel.dataSource,
            imo: vessel.imo,
            name: vessel.name,
            shipTypeLabel: vessel.shipTypeLabel,
            estimatedTeu: vessel.estimatedTeu,
            estimatedCapacityCbm: vessel.estimatedCapacityCbm,
            capacityEstimateJustification: vessel.capacityEstimateJustification,
            lastDraughtM: vessel.lastDraughtM,
            fullnessPercent: vessel.fullnessPercent,
            fullnessJustification: vessel.fullnessJustification,
            fullnessUpdatedAt: vessel.lastStaticDataAt,
            estimatedLocation:
              vessel.lastLat != null && vessel.lastLon != null
                ? estimateLocationLabel(vessel.lastLat, vessel.lastLon)
                : null,
            lastEtaRaw: vessel.lastEtaRaw,
            lastPositionAt: vessel.lastPositionAt,
          }
        : null,
      costs: this.buildCosts(container, cbmForCost),
    };
  }

  private deriveMatchStatus(container: Container, occupancy: number): string {
    if (container.status === 'closed') return 'Pelayaran Selesai';
    if (container.status === 'full') return 'Limited Capacity';
    if (occupancy < 30) return 'Awaiting Minimum Occupancy';
    if (occupancy < 70) return 'Slot Confirmed by Freight Forwarder';
    return 'Ready for Booking';
  }

  /**
   * Reacts to real voyage lifecycle transitions detected by
   * VoyageDetectionService. A Container (bookable LCL slot) is created as
   * soon as a real large cargo vessel is either:
   *  - detected near the origin port (AWAITING_DEPARTURE) - honestly-labelled
   *    ESTIMATED "ready today" (see syncAwaitingVoyage), or
   *  - detected anywhere else in the wider AIS region already broadcasting
   *    the origin port as its destination (INBOUND) - honestly-labelled
   *    ESTIMATED future ready date, from its real ETA to that port (see
   *    syncInboundVoyage) - so UMKM get real lead time instead of every
   *    container claiming to be "ready today".
   * so real ships stay continuously visible in matching results instead of
   * only appearing after departure. Physically arriving upgrades an INBOUND
   * container to the "ready today" estimate (syncArrivedAtOrigin). The
   * estimate is overwritten with the real AIS-confirmed date once the
   * vessel actually leaves (DEPARTED). Closed on ARRIVED/STALE.
   */
  @OnEvent('voyage.created')
  async handleVoyageCreated(payload: VoyageEventPayload) {
    if (payload.voyage.status === VoyageStatus.INBOUND) {
      await this.syncInboundVoyage(payload.voyage, payload.vessel);
    } else {
      await this.syncAwaitingVoyage(payload.voyage);
    }
  }

  @OnEvent('voyage.updated')
  async handleVoyageUpdated(payload: VoyageEventPayload) {
    const { voyage } = payload;
    if (voyage.status === VoyageStatus.AWAITING_DEPARTURE) {
      await this.syncArrivedAtOrigin(voyage);
    } else if (voyage.status === VoyageStatus.DEPARTED) {
      await this.syncDepartedVoyage(voyage);
    } else if (
      voyage.status === VoyageStatus.ARRIVED ||
      voyage.status === VoyageStatus.STALE
    ) {
      await this.closeVoyageContainer(voyage);
    }
  }

  /**
   * AIS ShipStaticData (type/length - what isLargeCargoVessel needs) almost
   * always arrives well after a vessel is first seen entering a port zone,
   * i.e. after `voyage.created` already fired and (if the vessel wasn't
   * classifiable yet) skipped container creation in syncAwaitingVoyage. This
   * re-checks any still-open AWAITING_DEPARTURE voyage for the vessel once
   * its static data comes in late, so a real qualifying ship isn't
   * permanently missed just because of message ordering.
   */
  @OnEvent('vessel.staticDataUpdated')
  async handleVesselStaticDataUpdated(payload: { vessel: Vessel }) {
    const { vessel } = payload;
    if (
      !isLargeCargoVessel({
        shipTypeCode: vessel.shipTypeCode,
        lengthM: vessel.lengthM,
      })
    )
      return;
    const openVoyage = await this.voyageRepo.findOneBy({
      vesselMmsi: vessel.mmsi,
      status: VoyageStatus.AWAITING_DEPARTURE,
    });
    if (!openVoyage) return;
    await this.syncAwaitingVoyage(openVoyage);
  }

  /**
   * A real large cargo vessel was just detected inside the origin port zone
   * (real AIS geofence entry - not invented). It hasn't departed yet, so we
   * don't know a real departure date; per the user's own heuristic, being
   * detected at/near the port is treated as "likely ready to load soon" and
   * estimated as departing today - always disclosed via
   * departureEstimateJustification and departureConfirmed=false, never
   * presented as a confirmed AIS departure.
   */
  private async syncAwaitingVoyage(voyage: Voyage) {
    const vessel = await this.vesselRepo.findOneBy({ mmsi: voyage.vesselMmsi });
    if (
      !isLargeCargoVessel({
        shipTypeCode: vessel?.shipTypeCode ?? null,
        lengthM: vessel?.lengthM ?? null,
      })
    ) {
      return;
    }
    const existing = await this.containerRepo.findOneBy({
      voyageId: voyage.id,
    });
    if (existing) return; // already tracked (e.g. re-entered the zone)

    const estimatedDeparture = new Date().toISOString().slice(0, 10);
    const { cargo, document } = this.cutoffs(estimatedDeparture);
    const guessedDestination = guessJapanZoneFromText(
      vessel?.lastDestinationRaw,
    );
    const freight = estimateFreightCost(
      voyage.originPortId,
      guessedDestination?.id ?? null,
    );

    const container = this.containerRepo.create({
      voyageId: voyage.id,
      vesselMmsi: voyage.vesselMmsi,
      destinationCountry: 'Japan',
      destinationCity:
        guessedDestination?.label ?? 'Menunggu konfirmasi tujuan',
      destinationConfidence: guessedDestination
        ? 'guessed_from_ais_text'
        : null,
      originPort: voyage.originPortLabel,
      originPortId: voyage.originPortId,
      containerType: ContainerType.FORTY_FT,
      totalCapacityCbm: 67.0,
      currentUsedCbm: 0,
      umkmCount: 0,
      departureDate: estimatedDeparture,
      departureConfirmed: false,
      departureEstimateJustification:
        `Kapal terdeteksi via AIS di sekitar ${voyage.originPortLabel} (real-time) - belum ada ` +
        `keberangkatan terkonfirmasi. Diestimasi siap memuat kargo baru dalam waktu dekat karena ` +
        `posisinya sudah dekat pelabuhan asal; tanggal keberangkatan akan diperbarui otomatis ke ` +
        `tanggal nyata begitu kapal benar-benar terdeteksi berangkat.`,
      cargoCutoffDate: cargo,
      documentCutoffDate: document,
      transitDays: null,
      costPerCbm: freight.costPerCbm,
      freightEstimateJustification: freight.justification,
      status: 'open',
    });
    await this.containerRepo.save(container);
  }

  /**
   * A real large cargo vessel was detected ELSEWHERE in the wider AIS region
   * (aisWideRegionBoundingBox), already broadcasting the origin port as its
   * AIS destination, but hasn't reached that port's geofence yet
   * (VoyageStatus.INBOUND). Unlike syncAwaitingVoyage (which estimates
   * "ready today" because the vessel is already there), this uses the
   * vessel's REAL distance/speed from its current AIS position to compute
   * an honest future ETA - so a ship several days out doesn't misleadingly
   * claim to be ready to load today. Re-derived live at view time too (see
   * toMatchView) so the date keeps tightening as the vessel gets closer.
   */
  private async syncInboundVoyage(voyage: Voyage, vesselHint?: Vessel) {
    const vessel =
      vesselHint ??
      (await this.vesselRepo.findOneBy({ mmsi: voyage.vesselMmsi }));
    if (
      !vessel ||
      !isLargeCargoVessel({
        shipTypeCode: vessel.shipTypeCode,
        lengthM: vessel.lengthM,
      })
    ) {
      return;
    }
    const existing = await this.containerRepo.findOneBy({
      voyageId: voyage.id,
    });
    if (existing) return;
    if (vessel.lastLat == null || vessel.lastLon == null) return;

    const eta = estimateEtaToOriginPort(
      { lat: vessel.lastLat, lon: vessel.lastLon },
      voyage.originPortId,
      vessel.lastSpeedKn,
    );
    if (!eta) return;

    const { cargo, document } = this.cutoffs(eta.estimatedArrivalDate);
    // JP destination isn't knowable yet - the vessel's current AIS Destination still says the ID origin port, not a Japan port.
    const freight = estimateFreightCost(voyage.originPortId, null);

    const container = this.containerRepo.create({
      voyageId: voyage.id,
      vesselMmsi: voyage.vesselMmsi,
      destinationCountry: 'Japan',
      destinationCity: 'Menunggu konfirmasi tujuan',
      destinationConfidence: null,
      originPort: voyage.originPortLabel,
      originPortId: voyage.originPortId,
      containerType: ContainerType.FORTY_FT,
      totalCapacityCbm: 67.0,
      currentUsedCbm: 0,
      umkmCount: 0,
      departureDate: eta.estimatedArrivalDate,
      departureConfirmed: false,
      departureEstimateJustification:
        `Kapal terdeteksi via AIS di kawasan Indonesia/Asia Tenggara, belum masuk zona ` +
        `${voyage.originPortLabel}, tapi sudah menyiarkan pelabuhan ini sebagai tujuan AIS-nya. ${eta.justification} ` +
        `Ini estimasi TIBA kapal di pelabuhan asal, bukan tanggal keberangkatan dari Jepang - begitu kapal ` +
        `tiba, kargo Anda perlu sudah berada di pelabuhan sebelum tanggal tersebut agar sempat dimuat.`,
      cargoCutoffDate: cargo,
      documentCutoffDate: document,
      transitDays: null,
      costPerCbm: freight.costPerCbm,
      freightEstimateJustification: freight.justification,
      status: 'open',
    });
    await this.containerRepo.save(container);
  }

  /**
   * An INBOUND voyage's vessel was just confirmed (real AIS geofence entry)
   * to have physically reached its origin port - upgrades the container
   * created by syncInboundVoyage from a distance-based future ETA to the
   * same "ready today" estimate real AWAITING_DEPARTURE containers get (see
   * syncAwaitingVoyage), since it's now honestly true: the vessel is there.
   */
  private async syncArrivedAtOrigin(voyage: Voyage) {
    const vessel = await this.vesselRepo.findOneBy({ mmsi: voyage.vesselMmsi });
    if (
      !isLargeCargoVessel({
        shipTypeCode: vessel?.shipTypeCode ?? null,
        lengthM: vessel?.lengthM ?? null,
      })
    ) {
      return;
    }
    const container = await this.containerRepo.findOneBy({
      voyageId: voyage.id,
    });
    if (!container) {
      // Shouldn't normally happen (the INBOUND stage should have created one), but don't leave a real arrival untracked.
      await this.syncAwaitingVoyage(voyage);
      return;
    }

    const estimatedDeparture = new Date().toISOString().slice(0, 10);
    const { cargo, document } = this.cutoffs(estimatedDeparture);
    container.originPort = voyage.originPortLabel;
    container.originPortId = voyage.originPortId;
    container.departureDate = estimatedDeparture;
    container.departureEstimateJustification =
      `Kapal terdeteksi via AIS TIBA di ${voyage.originPortLabel} (real-time; sebelumnya terlacak masih ` +
      `dalam perjalanan) - belum ada keberangkatan terkonfirmasi. Diestimasi siap memuat kargo baru dalam ` +
      `waktu dekat karena sudah berada di pelabuhan asal; tanggal keberangkatan akan diperbarui otomatis ke ` +
      `tanggal nyata begitu kapal benar-benar terdeteksi berangkat.`;
    container.cargoCutoffDate = cargo;
    container.documentCutoffDate = document;
    await this.containerRepo.save(container);
  }

  private async syncDepartedVoyage(voyage: Voyage) {
    if (!voyage.departedAt) return;

    // Only real, confirmed ocean-going cargo ships become a bookable slot -
    // see isLargeCargoVessel / VESSEL_FILTER_JUSTIFICATION. If the vessel's
    // type/dimensions aren't known yet, we skip rather than guess.
    const vessel = await this.vesselRepo.findOneBy({ mmsi: voyage.vesselMmsi });
    if (
      !isLargeCargoVessel({
        shipTypeCode: vessel?.shipTypeCode ?? null,
        lengthM: vessel?.lengthM ?? null,
      })
    ) {
      return;
    }

    const departureDate = voyage.departedAt.toISOString().slice(0, 10);
    const { cargo, document } = this.cutoffs(departureDate);
    const freight = estimateFreightCost(
      voyage.originPortId,
      voyage.destinationPortId,
    );
    const destinationCity =
      voyage.destinationPortLabel ?? 'Menunggu konfirmasi tujuan';

    let container = await this.containerRepo.findOneBy({ voyageId: voyage.id });
    if (!container) {
      container = this.containerRepo.create({
        voyageId: voyage.id,
        vesselMmsi: voyage.vesselMmsi,
        destinationCountry: 'Japan',
        totalCapacityCbm: 67.0,
        currentUsedCbm: 0,
        umkmCount: 0,
        containerType: ContainerType.FORTY_FT,
        status: 'open',
      });
    }
    container.destinationCity = destinationCity;
    container.destinationConfidence = voyage.destinationConfidence;
    container.originPort = voyage.originPortLabel;
    container.originPortId = voyage.originPortId;
    container.departureDate = departureDate;
    container.departureConfirmed = true;
    container.departureEstimateJustification = null;
    container.cargoCutoffDate = cargo;
    container.documentCutoffDate = document;
    container.costPerCbm = freight.costPerCbm;
    container.freightEstimateJustification = freight.justification;
    await this.containerRepo.save(container);
  }

  private async closeVoyageContainer(voyage: Voyage) {
    const container = await this.containerRepo.findOneBy({
      voyageId: voyage.id,
    });
    if (!container) return;
    container.status = 'closed';
    if (voyage.destinationPortLabel) {
      container.destinationCity = voyage.destinationPortLabel;
      container.destinationConfidence = voyage.destinationConfidence;
    }
    if (
      voyage.status === VoyageStatus.ARRIVED &&
      voyage.departedAt &&
      voyage.arrivedAt
    ) {
      container.transitDays = Math.round(
        (voyage.arrivedAt.getTime() - voyage.departedAt.getTime()) /
          (1000 * 60 * 60 * 24),
      );
    }
    await this.containerRepo.save(container);
  }
}
