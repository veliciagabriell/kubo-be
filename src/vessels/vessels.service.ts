import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vessel } from './entities/vessel.entity';
import { Voyage } from './entities/voyage.entity';
import { estimateLocationLabel, EstimatedLocation } from './lib/geo';
import { isLargeCargoVessel } from './lib/vessel-classification';

export interface VesselView {
  mmsi: string;
  dataSource: 'live_ais' | 'development_fixture';
  imo: string | null;
  name: string | null;
  callsign: string | null;
  shipTypeLabel: string | null;
  lengthM: number | null;
  beamM: number | null;
  estimatedTeu: number | null;
  estimatedCapacityCbm: number | null;
  capacityEstimateJustification: string | null;
  lastDraughtM: number | null;
  fullnessPercent: number | null;
  fullnessJustification: string | null;
  fullnessUpdatedAt: Date | null;
  lastDestinationRaw: string | null;
  lastEtaRaw: string | null;
  estimatedLocation: EstimatedLocation | null;
  lastSpeedKn: number | null;
  lastCourseDeg: number | null;
  lastPositionAt: Date | null;
}

export interface VoyageView {
  id: string;
  dataSource: 'live_ais' | 'development_fixture';
  originPort: string;
  destinationPort: string | null;
  destinationConfidence: string | null;
  status: string;
  departedAt: Date | null;
  arrivedAt: Date | null;
  lastSeenAt: Date;
  vessel: VesselView | null;
}

@Injectable()
export class VesselsService {
  constructor(
    @InjectRepository(Vessel) private readonly vesselRepo: Repository<Vessel>,
    @InjectRepository(Voyage) private readonly voyageRepo: Repository<Voyage>,
  ) {}

  /** Only real, confirmed ocean-going cargo ships - see isLargeCargoVessel. */
  async listVessels(): Promise<VesselView[]> {
    const vessels = await this.vesselRepo.find({
      order: { lastPositionAt: 'DESC' },
    });
    return vessels
      .filter((v) =>
        isLargeCargoVessel({
          shipTypeCode: v.shipTypeCode,
          lengthM: v.lengthM,
        }),
      )
      .map((v) => this.toVesselView(v));
  }

  async getVessel(mmsi: string): Promise<VesselView> {
    const vessel = await this.vesselRepo.findOneBy({ mmsi });
    if (!vessel) throw new NotFoundException('Vessel not found');
    return this.toVesselView(vessel);
  }

  async listVoyages(): Promise<VoyageView[]> {
    const voyages = await this.voyageRepo.find({
      order: { createdAt: 'DESC' },
    });
    return Promise.all(voyages.map((v) => this.toVoyageView(v)));
  }

  async getVoyage(id: string): Promise<VoyageView> {
    const voyage = await this.voyageRepo.findOneBy({ id });
    if (!voyage) throw new NotFoundException('Voyage not found');
    return this.toVoyageView(voyage);
  }

  private toVesselView(v: Vessel): VesselView {
    return {
      mmsi: v.mmsi,
      dataSource: v.dataSource,
      imo: v.imo,
      name: v.name,
      callsign: v.callsign,
      shipTypeLabel: v.shipTypeLabel,
      lengthM: v.lengthM,
      beamM: v.beamM,
      estimatedTeu: v.estimatedTeu,
      estimatedCapacityCbm: v.estimatedCapacityCbm,
      capacityEstimateJustification: v.capacityEstimateJustification,
      lastDraughtM: v.lastDraughtM,
      fullnessPercent: v.fullnessPercent,
      fullnessJustification: v.fullnessJustification,
      fullnessUpdatedAt: v.lastStaticDataAt,
      lastDestinationRaw: v.lastDestinationRaw,
      lastEtaRaw: v.lastEtaRaw,
      estimatedLocation:
        v.lastLat != null && v.lastLon != null
          ? estimateLocationLabel(v.lastLat, v.lastLon)
          : null,
      lastSpeedKn: v.lastSpeedKn,
      lastCourseDeg: v.lastCourseDeg,
      lastPositionAt: v.lastPositionAt,
    };
  }

  private async toVoyageView(v: Voyage): Promise<VoyageView> {
    const vessel = await this.vesselRepo.findOneBy({ mmsi: v.vesselMmsi });
    return {
      id: v.id,
      dataSource: v.dataSource,
      originPort: v.originPortLabel,
      destinationPort: v.destinationPortLabel,
      destinationConfidence: v.destinationConfidence,
      status: v.status,
      departedAt: v.departedAt,
      arrivedAt: v.arrivedAt,
      lastSeenAt: v.lastSeenAt,
      vessel: vessel ? this.toVesselView(vessel) : null,
    };
  }
}
