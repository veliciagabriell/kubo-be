import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Vessel } from './entities/vessel.entity';
import { Voyage, VoyageStatus } from './entities/voyage.entity';
import { findZoneForPosition, getPortZone, guessIndonesianOriginZoneFromText, guessJapanZoneFromText } from './lib/geo';
import { isLargeCargoVessel } from './lib/vessel-classification';

const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const STALE_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface VoyageEventPayload {
  voyage: Voyage;
  vessel?: Vessel;
}

/**
 * Turns raw AIS position reports into Voyage records using a per-vessel
 * geofence state machine over the 5 tracked port zones (geo.ts). Nothing is
 * scheduled - a Voyage exists only once a real vessel was actually observed
 * entering/leaving one of the zones.
 */
@Injectable()
export class VoyageDetectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoyageDetectionService.name);
  private readonly lastZoneByMmsi = new Map<string, string | undefined>();
  private staleSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Voyage) private readonly voyageRepo: Repository<Voyage>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.staleSweepTimer = setInterval(() => {
      this.sweepStaleVoyages().catch((err) => this.logger.error(`Stale sweep failed: ${err}`));
    }, STALE_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.staleSweepTimer) clearInterval(this.staleSweepTimer);
  }

  private openVoyageWhere(mmsi: string) {
    return [
      { vesselMmsi: mmsi, status: VoyageStatus.INBOUND },
      { vesselMmsi: mmsi, status: VoyageStatus.AWAITING_DEPARTURE },
      { vesselMmsi: mmsi, status: VoyageStatus.DEPARTED },
    ];
  }

  async handlePosition(vessel: Vessel, lat: number, lon: number, at: Date) {
    const zone = findZoneForPosition(lat, lon);
    const prevZoneId = this.lastZoneByMmsi.get(vessel.mmsi);
    this.lastZoneByMmsi.set(vessel.mmsi, zone?.id);

    // Checked on every position report (not just real zone transitions), so a
    // vessel becomes trackable as an INBOUND voyage as soon as BOTH its cargo
    // classification (AIS static data) and its Destination text are known -
    // wherever it currently is within the wider AIS region (see
    // aisWideRegionBoundingBox), not yet inside a tracked port's geofence.
    if (zone?.country !== 'ID') {
      await this.maybeTrackInboundVoyage(vessel, at);
    }

    if (zone?.id === prevZoneId) return; // no real geofence transition, nothing else to do

    const prevZone = prevZoneId ? getPortZone(prevZoneId) : undefined;
    const openVoyage = await this.voyageRepo.findOne({
      where: this.openVoyageWhere(vessel.mmsi),
      order: { createdAt: 'DESC' },
    });

    // Physically entered the origin port zone while a real INBOUND voyage is
    // already open for this vessel -> arrival confirmed by geofence. The
    // zone actually entered is ground truth and overrides the earlier
    // guessed-from-text origin port (crew-entered AIS Destination text can be
    // wrong/stale - see guessIndonesianOriginZoneFromText).
    if (zone?.country === 'ID' && openVoyage?.status === VoyageStatus.INBOUND) {
      openVoyage.status = VoyageStatus.AWAITING_DEPARTURE;
      openVoyage.originPortId = zone.id;
      openVoyage.originPortLabel = zone.label;
      openVoyage.lastSeenAt = at;
      await this.voyageRepo.save(openVoyage);
      await this.eventEmitter.emitAsync('voyage.updated', { voyage: openVoyage, vessel } as VoyageEventPayload);
      this.logger.log(`Voyage arrived at origin: ${vessel.name ?? vessel.mmsi} reached ${zone.label} (previously inbound)`);
      return;
    }

    // Left an Indonesian port that we had this vessel departing from -> DEPARTED
    if (
      prevZone?.country === 'ID' &&
      openVoyage?.status === VoyageStatus.AWAITING_DEPARTURE &&
      openVoyage.originPortId === prevZone.id
    ) {
      openVoyage.status = VoyageStatus.DEPARTED;
      openVoyage.departedAt = at;
      openVoyage.lastSeenAt = at;
      const guess = guessJapanZoneFromText(vessel.lastDestinationRaw);
      if (guess) {
        openVoyage.destinationPortId = guess.id;
        openVoyage.destinationPortLabel = guess.label;
        openVoyage.destinationConfidence = 'guessed_from_ais_text';
      }
      await this.voyageRepo.save(openVoyage);
      await this.eventEmitter.emitAsync('voyage.updated', { voyage: openVoyage, vessel } as VoyageEventPayload);
      this.logger.log(`Voyage departed: ${vessel.name ?? vessel.mmsi} left ${prevZone.label}`);
      return;
    }

    // Entered a Japan port zone while a departed voyage is open -> ARRIVED
    if (zone?.country === 'JP' && openVoyage?.status === VoyageStatus.DEPARTED) {
      openVoyage.status = VoyageStatus.ARRIVED;
      openVoyage.arrivedAt = at;
      openVoyage.lastSeenAt = at;
      openVoyage.destinationPortId = zone.id;
      openVoyage.destinationPortLabel = zone.label;
      openVoyage.destinationConfidence = 'confirmed_by_geofence';
      await this.voyageRepo.save(openVoyage);
      await this.eventEmitter.emitAsync('voyage.updated', { voyage: openVoyage, vessel } as VoyageEventPayload);
      this.logger.log(`Voyage arrived: ${vessel.name ?? vessel.mmsi} reached ${zone.label}`);
      return;
    }

    // Entered an Indonesian port with no open voyage yet -> new voyage tracked
    if (zone?.country === 'ID' && !openVoyage) {
      const voyage = this.voyageRepo.create({
        vesselMmsi: vessel.mmsi,
        originPortId: zone.id,
        originPortLabel: zone.label,
        status: VoyageStatus.AWAITING_DEPARTURE,
        lastSeenAt: at,
      });
      await this.voyageRepo.save(voyage);
      await this.eventEmitter.emitAsync('voyage.created', { voyage, vessel } as VoyageEventPayload);
      this.logger.log(`New voyage tracked: ${vessel.name ?? vessel.mmsi} at ${zone.label}`);
    }
  }

  /**
   * A large cargo vessel broadcasting one of the tracked ID origin ports as
   * its AIS Destination, seen anywhere in the wider region but not yet
   * inside that port's geofence, and with no voyage already open for it ->
   * tracked as INBOUND. Runs on every position report rather than only on
   * zone transitions, so it self-heals within seconds once classification
   * (ShipStaticData) and destination text are both known, instead of only
   * being checked once like the bug this replaced.
   */
  private async maybeTrackInboundVoyage(vessel: Vessel, at: Date) {
    if (!isLargeCargoVessel({ shipTypeCode: vessel.shipTypeCode, lengthM: vessel.lengthM })) return;
    const guess = guessIndonesianOriginZoneFromText(vessel.lastDestinationRaw);
    if (!guess) return;
    const existing = await this.voyageRepo.findOne({ where: this.openVoyageWhere(vessel.mmsi) });
    if (existing) return;

    const voyage = this.voyageRepo.create({
      vesselMmsi: vessel.mmsi,
      originPortId: guess.id,
      originPortLabel: guess.label,
      status: VoyageStatus.INBOUND,
      lastSeenAt: at,
    });
    await this.voyageRepo.save(voyage);
    await this.eventEmitter.emitAsync('voyage.created', { voyage, vessel } as VoyageEventPayload);
    this.logger.log(`Inbound voyage tracked: ${vessel.name ?? vessel.mmsi} heading to ${guess.label} (not yet arrived)`);
  }

  private async sweepStaleVoyages() {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const stale = await this.voyageRepo.find({
      where: [
        { status: VoyageStatus.INBOUND, lastSeenAt: LessThan(cutoff) },
        { status: VoyageStatus.AWAITING_DEPARTURE, lastSeenAt: LessThan(cutoff) },
        { status: VoyageStatus.DEPARTED, lastSeenAt: LessThan(cutoff) },
      ],
    });
    for (const voyage of stale) {
      voyage.status = VoyageStatus.STALE;
      await this.voyageRepo.save(voyage);
      await this.eventEmitter.emitAsync('voyage.updated', { voyage } as VoyageEventPayload);
    }
    if (stale.length) this.logger.log(`Marked ${stale.length} voyage(s) STALE (no AIS update for 14+ days)`);
  }
}
