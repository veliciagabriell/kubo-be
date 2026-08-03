import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

export interface ContainerMatchView extends Container {
  shipmentType: 'Consolidated LCL';
  estimatedDeparture: string;
  cargoCutoff: string | null;
  documentCutoff: string | null;
  occupancy: number;
  remainingCbm: number;
  participants: number;
  matchStatus: string;
  forwarder: {
    name: string;
    verified: boolean;
    rating: number;
    completedShipments: number;
  };
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
}

const FORWARDERS = [
  { name: 'PT Samudra Nusa Logistik', verified: true, rating: 4.8, completedShipments: 86 },
  { name: 'Nippon Java Freight', verified: true, rating: 4.7, completedShipments: 64 },
  { name: 'PT Lintas Timur Ekspor', verified: true, rating: 4.9, completedShipments: 112 },
  { name: 'Kirin Trans Pacific', verified: true, rating: 4.6, completedShipments: 41 },
];

@Injectable()
export class MatchingService implements OnModuleInit {
  constructor(
    @InjectRepository(Container)
    private readonly containerRepo: Repository<Container>,
  ) {}

  async onModuleInit() {
    const count = await this.containerRepo.count();
    if (count === 0) {
      await this.seedContainers();
      return;
    }
    await this.backfillDisplayFields();
  }

  /**
   * KUBO Smart Container Matching Algorithm
   *
   * Menggunakan pendekatan Weighted Multi-Criteria Decision Analysis (MCDA)
   * yang terinspirasi dari metode TOPSIS (Technique for Order of Preference
   * by Similarity to Ideal Solution).
   *
   * Kriteria penilaian (4 dimensi):
   * 1. Utilization Score (40%) – seberapa optimal container terisi setelah
   *    ditambah muatan user. Target optimal = 85% kapasitas.
   * 2. Date Proximity Score (35%) – seberapa dekat tanggal keberangkatan
   *    dengan preferensi user. Window = 30 hari.
   * 3. Collaboration Score (15%) – bonus jika sudah ada banyak UMKM lain
   *    yang bergabung (cost sharing lebih efisien).
   * 4. Fit Ratio Score (10%) – seberapa pas volume user mengisi sisa ruang.
   *
   * Final Score = 0.40×U + 0.35×D + 0.15×C + 0.10×F  ∈ [0, 1]
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

      scored.push({
        ...this.toMatchView(c, dto.volumeCbm),
        availableCbm: parseFloat(available.toFixed(2)),
        utilizationPercent,
        matchScore: parseFloat(matchScore.toFixed(4)),
        scoreBreakdown: {
          utilizationScore: parseFloat(scoreBreakdown.utilizationScore.toFixed(4)),
          dateProximityScore: parseFloat(scoreBreakdown.dateProximityScore.toFixed(4)),
          collaborationScore: parseFloat(scoreBreakdown.collaborationScore.toFixed(4)),
          fitRatioScore: parseFloat(scoreBreakdown.fitRatioScore.toFixed(4)),
        },
      });
    }

    return scored.sort((a, b) => b.matchScore - a.matchScore);
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

  async getAllContainers(forCbm = 5): Promise<ContainerMatchView[]> {
    const containers = await this.containerRepo.find({
      order: { departureDate: 'ASC' },
    });
    return containers.map((c) => this.toMatchView(c, forCbm));
  }

  async getContainerById(id: string, forCbm = 5): Promise<ContainerMatchView> {
    const container = await this.containerRepo.findOneBy({ id });
    if (!container) throw new NotFoundException('Container not found');
    return this.toMatchView(container, forCbm);
  }

  async getAlgorithmInfo() {
    return {
      name: 'KUBO Smart Container Matching',
      method: 'Weighted Multi-Criteria Decision Analysis (W-MCDA) / TOPSIS-inspired',
      description:
        'Menggabungkan 4 kriteria penilaian untuk menemukan container paling optimal bagi muatan UMKM.',
      criteria: [
        {
          name: 'Utilization Score',
          weight: 0.4,
          description:
            'Seberapa optimal penggunaan container setelah ditambah volume user. Target 85% kapasitas.',
          formula: 'max(0, 1 - |utilization_baru - 0.85| / 0.85)',
        },
        {
          name: 'Date Proximity Score',
          weight: 0.35,
          description:
            'Kedekatan tanggal keberangkatan dengan preferensi user (window 30 hari).',
          formula: 'max(0, 1 - |selisih_hari| / 30)',
        },
        {
          name: 'Collaboration Score',
          weight: 0.15,
          description:
            'Bonus untuk container yang sudah memiliki banyak UMKM bergabung (cost sharing efisien).',
          formula: 'min(1, umkm_count / 5)',
        },
        {
          name: 'Fit Ratio Score',
          weight: 0.1,
          description:
            'Seberapa pas volume muatan user mengisi sisa ruang yang tersedia.',
          formula: 'min(1, requested_cbm / available_cbm)',
        },
      ],
      finalFormula: 'Score = 0.40×U + 0.35×D + 0.15×C + 0.10×F',
      scoreRange: '[0, 1] – semakin mendekati 1 semakin optimal',
    };
  }

  private toMatchView(container: Container, cbmForCost: number): ContainerMatchView {
    const occupancy = Math.round(
      (container.currentUsedCbm / container.totalCapacityCbm) * 100,
    );
    const remainingCbm = parseFloat(
      (container.totalCapacityCbm - container.currentUsedCbm).toFixed(2),
    );
    return {
      ...container,
      shipmentType: 'Consolidated LCL',
      estimatedDeparture: container.departureDate,
      cargoCutoff: container.cargoCutoffDate,
      documentCutoff: container.documentCutoffDate,
      occupancy,
      remainingCbm,
      participants: container.umkmCount,
      matchStatus: this.deriveMatchStatus(container, occupancy),
      forwarder: {
        name: container.forwarderName ?? FORWARDERS[0].name,
        verified: container.forwarderVerified,
        rating: container.forwarderRating,
        completedShipments: container.forwarderCompletedShipments,
      },
      costs: this.buildCosts(container, cbmForCost),
    };
  }

  private deriveMatchStatus(container: Container, occupancy: number): string {
    if (container.status === 'full') return 'Limited Capacity';
    if (occupancy < 30) return 'Awaiting Minimum Occupancy';
    if (occupancy < 70) return 'Slot Confirmed by Freight Forwarder';
    return 'Ready for Booking';
  }

  private buildCosts(container: Container, cbm: number): CostBreakdownView {
    const freight = Math.round(container.costPerCbm * cbm);
    const platformFee = Math.round(cbm * 500);
    const documentAssistance = 100000;
    const handling = 0;
    const insurance = 0;
    const taxes = 0;
    const subscription = 0;
    const total =
      freight + platformFee + documentAssistance + handling + insurance + taxes + subscription;
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

  private async backfillDisplayFields() {
    const containers = await this.containerRepo.find();
    const now = new Date();
    const stale = containers.filter(
      (c) => !c.forwarderName || !c.cargoCutoffDate || new Date(c.departureDate) < now,
    );
    if (stale.length === 0) return;

    for (const [i, c] of stale.entries()) {
      const forwarder = FORWARDERS[i % FORWARDERS.length];
      if (new Date(c.departureDate) < now) {
        const future = new Date(now);
        future.setDate(future.getDate() + 21 + i * 5);
        c.departureDate = future.toISOString().slice(0, 10);
      }
      const { cargo, document } = this.cutoffs(c.departureDate);
      c.originPort = c.originPort || 'Tanjung Emas, Semarang';
      c.forwarderName = c.forwarderName || forwarder.name;
      c.forwarderVerified = forwarder.verified;
      c.forwarderRating = forwarder.rating;
      c.forwarderCompletedShipments = forwarder.completedShipments;
      c.cargoCutoffDate = cargo;
      c.documentCutoffDate = document;
      c.transitDays = c.transitDays || 17;
    }
    await this.containerRepo.save(stale);
  }

  private async seedContainers() {
    const base = [
      {
        destinationCountry: 'Japan',
        destinationCity: 'Tokyo',
        containerType: ContainerType.FORTY_FT,
        totalCapacityCbm: 67.0,
        currentUsedCbm: 45.5,
        departureDate: '2026-08-28',
        costPerCbm: 1250000,
        status: 'open',
        umkmCount: 6,
      },
      {
        destinationCountry: 'Japan',
        destinationCity: 'Osaka',
        containerType: ContainerType.FORTY_FT,
        totalCapacityCbm: 67.0,
        currentUsedCbm: 28.2,
        departureDate: '2026-09-03',
        costPerCbm: 1175000,
        status: 'open',
        umkmCount: 4,
      },
      {
        destinationCountry: 'Japan',
        destinationCity: 'Kyoto',
        containerType: ContainerType.FORTY_FT,
        totalCapacityCbm: 67.0,
        currentUsedCbm: 59.7,
        departureDate: '2026-08-24',
        costPerCbm: 1325000,
        status: 'open',
        umkmCount: 8,
      },
      {
        destinationCountry: 'Japan',
        destinationCity: 'Nagoya',
        containerType: ContainerType.FORTY_FT_HC,
        totalCapacityCbm: 76.0,
        currentUsedCbm: 30.0,
        departureDate: '2026-09-10',
        costPerCbm: 1150000,
        status: 'open',
        umkmCount: 3,
      },
      {
        destinationCountry: 'Japan',
        destinationCity: 'Yokohama',
        containerType: ContainerType.TWENTY_FT,
        totalCapacityCbm: 28.0,
        currentUsedCbm: 5.0,
        departureDate: '2026-09-15',
        costPerCbm: 1275000,
        status: 'open',
        umkmCount: 1,
      },
      {
        destinationCountry: 'Japan',
        destinationCity: 'Kobe',
        containerType: ContainerType.FORTY_FT_HC,
        totalCapacityCbm: 76.0,
        currentUsedCbm: 0,
        departureDate: '2026-09-20',
        costPerCbm: 1150000,
        status: 'open',
        umkmCount: 0,
      },
    ];

    const containers = base.map((c, i) => {
      const forwarder = FORWARDERS[i % FORWARDERS.length];
      const { cargo, document } = this.cutoffs(c.departureDate);
      return {
        ...c,
        originPort: 'Tanjung Emas, Semarang',
        cargoCutoffDate: cargo,
        documentCutoffDate: document,
        transitDays: 16 + (i % 3),
        forwarderName: forwarder.name,
        forwarderVerified: forwarder.verified,
        forwarderRating: forwarder.rating,
        forwarderCompletedShipments: forwarder.completedShipments,
      };
    });

    await this.containerRepo.save(containers);
  }
}
