import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import WebSocket from 'ws';
import { computeFullness, estimateCapacity } from './lib/capacity-estimate';
import { aisShipTypeLabel, aisSubscriptionBoundingBoxes, aisWideRegionBoundingBox } from './lib/geo';
import { Vessel } from './entities/vessel.entity';
import { VoyageDetectionService } from './voyage-detection.service';

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

interface AisMetaData {
  MMSI: number;
  ShipName?: string;
  latitude?: number;
  longitude?: number;
  time_utc?: string;
}

interface AisEnvelope {
  MessageType: string;
  MetaData: AisMetaData;
  Message: Record<string, any>;
}

/**
 * WebSocket client for AISstream.io (https://aisstream.io) - a free live AIS
 * feed. This is the ONLY place `AISSTREAM_API_KEY` is used and the only
 * websocket connection in the app. Subscribes to bounding boxes around
 * Tanjung Emas, Tanjung Perak, and the three tracked Japan port zones
 * (geo.ts), and reacts to PositionReport / ShipStaticData messages by
 * upserting `Vessel` rows and forwarding position updates to
 * VoyageDetectionService for geofence-based departure/arrival detection.
 */
@Injectable()
export class AisStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AisStreamService.name);
  private socket: WebSocket | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    @InjectRepository(Vessel) private readonly vesselRepo: Repository<Vessel>,
    private readonly voyageDetection: VoyageDetectionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    const apiKey = process.env.AISSTREAM_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'AISSTREAM_API_KEY not set - live ship tracking is disabled. Get a free key at ' +
          'https://aisstream.io and add it to .env to enable real vessel tracking. The app ' +
          'will keep running with no dummy fallback data.',
      );
      return;
    }
    this.connect(apiKey);
  }

  onModuleDestroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  private connect(apiKey: string) {
    this.socket = new WebSocket(AISSTREAM_URL);

    this.socket.on('open', () => {
      this.logger.log(
        'Connected to AISstream.io - subscribing to Tanjung Emas / Tanjung Perak / Japan port zones ' +
          '+ wider Indonesia/SE Asia corridor (for vessels still inbound to the origin ports)',
      );
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.socket?.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [...aisSubscriptionBoundingBoxes(), aisWideRegionBoundingBox()],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        }),
      );
    });

    this.socket.on('message', (raw: WebSocket.RawData) => {
      this.handleMessage(raw.toString()).catch((err) =>
        this.logger.error(`Failed to process AIS message: ${err}`),
      );
    });

    this.socket.on('close', () => {
      if (this.destroyed) return;
      this.logger.warn(`AISstream connection closed - reconnecting in ${this.backoffMs}ms`);
      this.scheduleReconnect(apiKey);
    });

    this.socket.on('error', (err: Error) => {
      this.logger.error(`AISstream connection error: ${err.message}`);
    });
  }

  private scheduleReconnect(apiKey: string) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.connect(apiKey);
    }, this.backoffMs);
  }

  private async handleMessage(raw: string) {
    let envelope: AisEnvelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return;
    }
    const mmsi = envelope.MetaData?.MMSI != null ? String(envelope.MetaData.MMSI) : '';
    if (!mmsi) return;

    if (envelope.MessageType === 'PositionReport') {
      await this.handlePositionReport(mmsi, envelope.Message.PositionReport, envelope.MetaData);
    } else if (envelope.MessageType === 'ShipStaticData') {
      await this.handleShipStaticData(mmsi, envelope.Message.ShipStaticData, envelope.MetaData);
    }
  }

  private async getOrCreateVessel(mmsi: string, name?: string | null): Promise<Vessel> {
    const existing = await this.vesselRepo.findOneBy({ mmsi });
    if (existing) return existing;
    return this.vesselRepo.create({ mmsi, name: name ?? null });
  }

  private async handlePositionReport(mmsi: string, pos: any, meta: AisMetaData) {
    if (pos?.Latitude == null || pos?.Longitude == null) return;
    const vessel = await this.getOrCreateVessel(mmsi, meta.ShipName);
    vessel.lastLat = pos.Latitude;
    vessel.lastLon = pos.Longitude;
    vessel.lastSpeedKn = typeof pos.Sog === 'number' ? pos.Sog : vessel.lastSpeedKn;
    vessel.lastCourseDeg = typeof pos.Cog === 'number' ? pos.Cog : vessel.lastCourseDeg;
    vessel.lastNavStatus = pos.NavigationalStatus != null ? String(pos.NavigationalStatus) : vessel.lastNavStatus;
    vessel.lastPositionAt = meta.time_utc ? new Date(meta.time_utc) : new Date();
    await this.vesselRepo.save(vessel);

    await this.voyageDetection.handlePosition(vessel, pos.Latitude, pos.Longitude, vessel.lastPositionAt);
  }

  private async handleShipStaticData(mmsi: string, data: any, meta: AisMetaData) {
    const vessel = await this.getOrCreateVessel(mmsi, data?.Name ?? meta.ShipName);

    vessel.imo = data?.ImoNumber ? String(data.ImoNumber) : vessel.imo;
    vessel.callsign = data?.CallSign || vessel.callsign;
    vessel.name = data?.Name || meta.ShipName || vessel.name;
    vessel.lastStaticDataAt = meta.time_utc ? new Date(meta.time_utc) : new Date();
    if (typeof data?.Type === 'number') {
      vessel.shipTypeCode = data.Type;
      vessel.shipTypeLabel = aisShipTypeLabel(data.Type);
    }
    vessel.lastDestinationRaw = data?.Destination || vessel.lastDestinationRaw;

    if (data?.Eta) {
      const { Month, Day, Hour, Minute } = data.Eta;
      if (Month && Day) {
        vessel.lastEtaRaw =
          `${String(Month).padStart(2, '0')}-${String(Day).padStart(2, '0')} ` +
          `${String(Hour ?? 0).padStart(2, '0')}:${String(Minute ?? 0).padStart(2, '0')} UTC`;
      }
    }

    if (data?.Dimension) {
      const { A, B, C, D } = data.Dimension;
      if (typeof A === 'number' && typeof B === 'number') vessel.lengthM = A + B;
      if (typeof C === 'number' && typeof D === 'number') vessel.beamM = C + D;
      if (vessel.lengthM && vessel.beamM) {
        const cap = estimateCapacity(vessel.lengthM, vessel.beamM);
        vessel.estimatedTeu = cap.estimatedTeu;
        vessel.estimatedCapacityCbm = cap.estimatedCapacityCbm;
        vessel.capacityEstimateJustification = cap.justification;
      }
    }

    if (typeof data?.MaximumStaticDraught === 'number' && data.MaximumStaticDraught > 0) {
      const draught = data.MaximumStaticDraught;
      vessel.lastDraughtM = draught;
      vessel.minDraughtM = vessel.minDraughtM == null ? draught : Math.min(vessel.minDraughtM, draught);
      vessel.maxDraughtM = vessel.maxDraughtM == null ? draught : Math.max(vessel.maxDraughtM, draught);
      const fullness = computeFullness(vessel.minDraughtM, vessel.maxDraughtM, vessel.lastDraughtM);
      vessel.fullnessPercent = fullness.fullnessPercent;
      vessel.fullnessJustification = fullness.justification;
    }

    await this.vesselRepo.save(vessel);
    // Ship type/length (needed to classify as a large cargo vessel) usually
    // arrives well after the vessel is first seen and any voyage for it was
    // created - notify listeners (MatchingService) so an already-open
    // AWAITING_DEPARTURE voyage can be re-checked instead of staying
    // permanently unclassified.
    await this.eventEmitter.emitAsync('vessel.staticDataUpdated', { vessel });
  }
}
