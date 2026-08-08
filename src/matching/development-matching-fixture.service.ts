import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vessel } from '../vessels/entities/vessel.entity';
import { Voyage, VoyageStatus } from '../vessels/entities/voyage.entity';
import { getPortZone } from '../vessels/lib/geo';
import { Container, ContainerType } from './entities/container.entity';

interface FixtureDefinition {
  vesselMmsi: string;
  vesselName: string;
  voyageId: string;
  containerId: string;
  originPortId: 'tanjung_emas' | 'tanjung_perak';
  destinationPortId: 'tokyo_bay' | 'nagoya' | 'osaka_kobe';
  departureOffsetDays: number;
  currentUsedCbm: number;
  umkmCount: number;
}

const FIXTURES: FixtureDefinition[] = [
  {
    vesselMmsi: '900000001',
    vesselName: 'KUBO DEV NUSANTARA',
    voyageId: '00000000-0000-4000-8000-000000000001',
    containerId: '00000000-0000-4000-8000-000000000011',
    originPortId: 'tanjung_emas',
    destinationPortId: 'tokyo_bay',
    departureOffsetDays: 0,
    currentUsedCbm: 18,
    umkmCount: 2,
  },
  {
    vesselMmsi: '900000002',
    vesselName: 'KUBO DEV SAMUDRA',
    voyageId: '00000000-0000-4000-8000-000000000002',
    containerId: '00000000-0000-4000-8000-000000000012',
    originPortId: 'tanjung_perak',
    destinationPortId: 'nagoya',
    departureOffsetDays: 7,
    currentUsedCbm: 31,
    umkmCount: 4,
  },
  {
    vesselMmsi: '900000003',
    vesselName: 'KUBO DEV CAKRAWALA',
    voyageId: '00000000-0000-4000-8000-000000000003',
    containerId: '00000000-0000-4000-8000-000000000013',
    originPortId: 'tanjung_emas',
    destinationPortId: 'osaka_kobe',
    departureOffsetDays: 14,
    currentUsedCbm: 8,
    umkmCount: 1,
  },
];

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (process.env[name] ?? '').trim().toLowerCase(),
  );
}

function dateAfterDays(days: number): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateBeforeDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

/**
 * Creates clearly-labelled, deterministic development records so matching,
 * checkout, shipment documents, and OCR can be exercised when the external
 * AISstream feed is unavailable. The service is opt-in and refuses to seed
 * unless APP_ENV is explicitly development or test.
 */
@Injectable()
export class DevelopmentMatchingFixtureService implements OnModuleInit {
  private readonly logger = new Logger(DevelopmentMatchingFixtureService.name);

  constructor(
    @InjectRepository(Vessel)
    private readonly vesselRepo: Repository<Vessel>,
    @InjectRepository(Voyage)
    private readonly voyageRepo: Repository<Voyage>,
    @InjectRepository(Container)
    private readonly containerRepo: Repository<Container>,
  ) {}

  async onModuleInit() {
    if (!envFlag('MATCHING_FIXTURE_ENABLED')) return;

    const appEnv = (process.env.APP_ENV ?? '').trim().toLowerCase();
    if (!['development', 'test'].includes(appEnv)) {
      this.logger.error(
        'MATCHING_FIXTURE_ENABLED was ignored because APP_ENV is not explicitly development or test',
      );
      return;
    }

    const configuredBaseDays = Number(
      process.env.MATCHING_FIXTURE_DEPARTURE_DAYS ?? 14,
    );
    const baseDays = Number.isFinite(configuredBaseDays)
      ? Math.min(180, Math.max(1, Math.round(configuredBaseDays)))
      : 14;

    for (const definition of FIXTURES) {
      await this.upsertFixture(definition, baseDays);
    }

    this.logger.warn(
      `Development matching fixtures active: ${FIXTURES.length} non-AIS container candidates are available`,
    );
  }

  private async upsertFixture(definition: FixtureDefinition, baseDays: number) {
    const now = new Date();
    const origin = getPortZone(definition.originPortId)!;
    const destination = getPortZone(definition.destinationPortId)!;
    const departureDate = dateAfterDays(
      baseDays + definition.departureOffsetDays,
    );

    const existingVessel = await this.vesselRepo.findOneBy({
      mmsi: definition.vesselMmsi,
    });
    await this.vesselRepo.save(
      this.vesselRepo.create({
        ...existingVessel,
        mmsi: definition.vesselMmsi,
        dataSource: 'development_fixture',
        imo: `DEV-${definition.vesselMmsi}`,
        name: definition.vesselName,
        callsign: `DEV${definition.vesselMmsi.slice(-3)}`,
        shipTypeCode: 70,
        shipTypeLabel: 'Cargo (development fixture)',
        lengthM: 180,
        beamM: 28,
        estimatedTeu: 593,
        estimatedCapacityCbm: 19_688,
        capacityEstimateJustification:
          'Development fixture; not derived from live AIS data.',
        minDraughtM: 6,
        maxDraughtM: 10,
        lastDraughtM: 8,
        fullnessPercent: 50,
        fullnessJustification:
          'Development fixture; deterministic value for UI and matching tests.',
        lastNavStatus: '5',
        lastDestinationRaw: destination.label,
        lastEtaRaw: null,
        lastLat: origin.center.lat,
        lastLon: origin.center.lon,
        lastSpeedKn: 0,
        lastCourseDeg: 0,
        lastPositionAt: now,
        lastStaticDataAt: now,
      }),
    );

    const existingVoyage = await this.voyageRepo.findOneBy({
      id: definition.voyageId,
    });
    await this.voyageRepo.save(
      this.voyageRepo.create({
        ...existingVoyage,
        id: definition.voyageId,
        dataSource: 'development_fixture',
        vesselMmsi: definition.vesselMmsi,
        originPortId: origin.id,
        originPortLabel: origin.label,
        departedAt: null,
        destinationPortId: destination.id,
        destinationPortLabel: destination.label,
        destinationConfidence: 'guessed_from_ais_text',
        status: VoyageStatus.AWAITING_DEPARTURE,
        arrivedAt: null,
        lastSeenAt: now,
      }),
    );

    const existingContainer = await this.containerRepo.findOneBy({
      id: definition.containerId,
    });
    await this.containerRepo.save(
      this.containerRepo.create({
        ...existingContainer,
        id: definition.containerId,
        dataSource: 'development_fixture',
        voyageId: definition.voyageId,
        vesselMmsi: definition.vesselMmsi,
        destinationCountry: 'Japan',
        destinationCity: destination.label,
        destinationConfidence: 'development_fixture',
        originPort: origin.label,
        originPortId: origin.id,
        containerType: ContainerType.FORTY_FT,
        totalCapacityCbm: 67,
        currentUsedCbm:
          existingContainer?.currentUsedCbm ?? definition.currentUsedCbm,
        departureDate,
        departureConfirmed: false,
        departureEstimateJustification:
          'Development fixture; date is generated for local end-to-end testing and is not AIS data.',
        cargoCutoffDate: dateBeforeDays(departureDate, 5),
        documentCutoffDate: dateBeforeDays(departureDate, 7),
        transitDays: null,
        costPerCbm: 950_000,
        freightEstimateJustification:
          'Development fixture; deterministic cost for local checkout testing, not a carrier quote.',
        status: existingContainer?.status ?? 'open',
        umkmCount: existingContainer?.umkmCount ?? definition.umkmCount,
      }),
    );
  }
}
