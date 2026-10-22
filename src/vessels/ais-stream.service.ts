import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import WebSocket from 'ws';
import { computeFullness, estimateCapacity } from './lib/capacity-estimate';
import {
  aisShipTypeLabel,
  aisSubscriptionBoundingBoxes,
  aisWideRegionBoundingBox,
} from './lib/geo';
import { Vessel } from './entities/vessel.entity';
import { VoyageDetectionService } from './voyage-detection.service';

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_WATCHDOG_TIMEOUT_MS = 60_000;
const MIN_WATCHDOG_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 60 * 60_000;
const AIS_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
] as const;

interface AisMetaData {
  MMSI: number;
  ShipName?: string;
  latitude?: number;
  longitude?: number;
  time_utc?: string;
}

interface AisEnvelope {
  MessageType?: string;
  MetaData?: AisMetaData;
  Metadata?: AisMetaData;
  Message?: Record<string, any>;
  error?: string;
}

export type AisStreamState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'receiving'
  | 'degraded'
  | 'reconnecting'
  | 'error';

export interface AisStreamHealthStatus {
  enabled: boolean;
  connected: boolean;
  healthy: boolean;
  state: AisStreamState;
  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  lastDataMessageAt: string | null;
  messageCount: number;
  processedMessageCount: number;
  errorMessageCount: number;
  ignoredMessageCount: number;
  reconnectCount: number;
  rateLimitCount: number;
  nextReconnectAt: string | null;
  rateLimitedUntil: string | null;
  lastError: string | null;
  watchdogTimeoutMs: number;
  subscribedMessageTypes: readonly string[];
}

function watchdogTimeoutFromEnv(): number {
  const configured = Number(process.env.AISSTREAM_WATCHDOG_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < MIN_WATCHDOG_TIMEOUT_MS) {
    return DEFAULT_WATCHDOG_TIMEOUT_MS;
  }
  return configured;
}

function rateLimitCooldownFromEnv(): number {
  const configured = Number(process.env.AISSTREAM_RATE_LIMIT_COOLDOWN_MS);
  if (!Number.isFinite(configured) || configured < 60_000) {
    return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  }
  return configured;
}

function retryAfterMs(
  value: string | string[] | undefined,
): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/**
 * WebSocket client for AISstream.io (https://aisstream.io) - a free live AIS
 * feed. This is the ONLY place `AISSTREAM_API_KEY` is used and the only
 * websocket connection in the app. Subscribes to bounding boxes around
 * Tanjung Emas, Tanjung Perak, and the three tracked Japan port zones
 * (geo.ts), and reacts to Class A/Class B position and static-data messages
 * by upserting `Vessel` rows and forwarding position updates to
 * VoyageDetectionService for geofence-based departure/arrival detection.
 */
@Injectable()
export class AisStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AisStreamService.name);
  private readonly watchdogTimeoutMs = watchdogTimeoutFromEnv();
  private readonly rateLimitCooldownMs = rateLimitCooldownFromEnv();
  private socket: WebSocket | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private awaitingPong = false;
  private destroyed = false;
  private enabled = false;
  private connected = false;
  private state: AisStreamState = 'disabled';
  private lastConnectedAt: Date | null = null;
  private lastMessageAt: Date | null = null;
  private lastDataMessageAt: Date | null = null;
  private messageCount = 0;
  private processedMessageCount = 0;
  private errorMessageCount = 0;
  private ignoredMessageCount = 0;
  private reconnectCount = 0;
  private rateLimitCount = 0;
  private nextReconnectAt: Date | null = null;
  private rateLimitedUntil: Date | null = null;
  private lastError: string | null = null;

  constructor(
    @InjectRepository(Vessel) private readonly vesselRepo: Repository<Vessel>,
    private readonly voyageDetection: VoyageDetectionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    const explicitlyEnabled =
      (process.env.AISSTREAM_ENABLED ?? 'true').toLowerCase() === 'true';
    if (!explicitlyEnabled || process.env.VERCEL === '1') {
      this.logger.warn(
        'Live AIS WebSocket is disabled for this runtime. Run it in a persistent worker/container.',
      );
      return;
    }
    const apiKey = process.env.AISSTREAM_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'AISSTREAM_API_KEY not set - live ship tracking is disabled. Get a free key at ' +
          'https://aisstream.io and add it to .env to enable real vessel tracking. The app ' +
          'will keep running with no dummy fallback data.',
      );
      return;
    }
    this.enabled = true;
    this.connect(apiKey);
  }

  onModuleDestroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearWatchdog();
    this.clearHeartbeat();
    this.socket?.close();
  }

  getHealthStatus(): AisStreamHealthStatus {
    const withinInitialGracePeriod =
      this.connected &&
      this.lastConnectedAt != null &&
      this.lastDataMessageAt == null &&
      this.lastError == null &&
      Date.now() - this.lastConnectedAt.getTime() < this.watchdogTimeoutMs;

    return {
      enabled: this.enabled,
      connected: this.connected,
      healthy: this.state === 'receiving' || withinInitialGracePeriod,
      state: this.state,
      lastConnectedAt: this.lastConnectedAt?.toISOString() ?? null,
      lastMessageAt: this.lastMessageAt?.toISOString() ?? null,
      lastDataMessageAt: this.lastDataMessageAt?.toISOString() ?? null,
      messageCount: this.messageCount,
      processedMessageCount: this.processedMessageCount,
      errorMessageCount: this.errorMessageCount,
      ignoredMessageCount: this.ignoredMessageCount,
      reconnectCount: this.reconnectCount,
      rateLimitCount: this.rateLimitCount,
      nextReconnectAt: this.nextReconnectAt?.toISOString() ?? null,
      rateLimitedUntil: this.rateLimitedUntil?.toISOString() ?? null,
      lastError: this.lastError,
      watchdogTimeoutMs: this.watchdogTimeoutMs,
      subscribedMessageTypes: AIS_MESSAGE_TYPES,
    };
  }

  private connect(apiKey: string) {
    if (this.destroyed) return;
    this.clearWatchdog();
    this.clearHeartbeat();
    this.state = 'connecting';
    this.connected = false;
    this.nextReconnectAt = null;

    const socket = new WebSocket(AISSTREAM_URL);
    this.socket = socket;

    socket.on('open', () => {
      if (this.socket !== socket || this.destroyed) return;
      this.connected = true;
      this.state = this.lastError ? 'degraded' : 'connected';
      this.lastConnectedAt = new Date();
      this.logger.log(
        'Connected to AISstream.io - subscribing to Tanjung Emas / Tanjung Perak / Japan port zones ' +
          '+ wider Indonesia/SE Asia corridor (for vessels still inbound to the origin ports)',
      );
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [
            ...aisSubscriptionBoundingBoxes(),
            aisWideRegionBoundingBox(),
          ],
          FilterMessageTypes: AIS_MESSAGE_TYPES,
        }),
      );
      this.startHeartbeat(socket);
      this.armWatchdog(apiKey, socket);
    });

    socket.on('pong', () => {
      if (this.socket === socket) this.awaitingPong = false;
    });

    socket.on('unexpected-response', (_request, response) => {
      if (this.socket !== socket) return;
      const statusCode = response.statusCode ?? 0;
      const message = `Unexpected server response: ${statusCode}`;
      this.state = 'error';
      this.lastError = message;
      if (statusCode === 429) {
        this.applyRateLimitCooldown(
          retryAfterMs(response.headers['retry-after']),
        );
      }
      this.logger.error(`AISstream connection error: ${message}`);
      response.resume();
      socket.terminate();
    });

    socket.on('message', (raw: WebSocket.RawData) => {
      if (this.socket !== socket || this.destroyed) return;
      this.messageCount += 1;
      this.lastMessageAt = new Date();
      this.handleMessage(raw.toString(), apiKey, socket).catch(
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.lastError = message;
          this.state = 'error';
          this.logger.error(`Failed to process AIS message: ${message}`);
        },
      );
    });

    socket.on('close', (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected = false;
      this.clearWatchdog();
      this.clearHeartbeat();
      if (this.destroyed) return;
      this.state = 'reconnecting';
      const reasonText = reason.toString().trim();
      const reconnectDelayMs = this.reconnectDelayMs();
      this.nextReconnectAt = new Date(Date.now() + reconnectDelayMs);
      this.logger.warn(
        `AISstream connection closed (code ${code}${reasonText ? `: ${reasonText}` : ''}) - ` +
          `reconnecting in ${reconnectDelayMs}ms`,
      );
      this.scheduleReconnect(apiKey, reconnectDelayMs);
    });

    socket.on('error', (err: Error) => {
      if (this.socket !== socket) return;
      if (
        this.rateLimitedUntil &&
        this.rateLimitedUntil.getTime() > Date.now()
      ) {
        this.logger.warn(
          `AISstream socket closed during rate-limit cooldown: ${err.message}`,
        );
        return;
      }
      this.state = 'error';
      this.lastError = err.message;
      if (/\b429\b|rate.?limit|throttl/i.test(err.message)) {
        this.applyRateLimitCooldown();
      }
      this.logger.error(`AISstream connection error: ${err.message}`);
    });
  }

  private reconnectDelayMs(): number {
    const rateLimitDelay = this.rateLimitedUntil
      ? Math.max(0, this.rateLimitedUntil.getTime() - Date.now())
      : 0;
    return Math.max(this.backoffMs, rateLimitDelay);
  }

  private scheduleReconnect(apiKey: string, delayMs: number) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectCount += 1;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.connect(apiKey);
    }, delayMs);
  }

  private applyRateLimitCooldown(serverDelayMs?: number) {
    if (this.rateLimitedUntil && this.rateLimitedUntil.getTime() > Date.now())
      return;
    this.rateLimitCount += 1;
    const exponentialDelayMs = Math.min(
      this.rateLimitCooldownMs * 2 ** (this.rateLimitCount - 1),
      MAX_RATE_LIMIT_COOLDOWN_MS,
    );
    const candidate = new Date(
      Date.now() + Math.max(serverDelayMs ?? 0, exponentialDelayMs),
    );
    if (!this.rateLimitedUntil || candidate > this.rateLimitedUntil) {
      this.rateLimitedUntil = candidate;
    }
  }

  private startHeartbeat(socket: WebSocket) {
    this.clearHeartbeat();
    this.awaitingPong = false;
    this.heartbeatTimer = setInterval(() => {
      if (
        this.destroyed ||
        this.socket !== socket ||
        socket.readyState !== WebSocket.OPEN
      )
        return;
      if (this.awaitingPong) {
        this.state = 'degraded';
        this.lastError = 'AISstream WebSocket heartbeat timed out';
        this.logger.warn(
          `${this.lastError}; terminating the socket so it can reconnect.`,
        );
        socket.terminate();
        return;
      }
      this.awaitingPong = true;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.awaitingPong = false;
  }

  private armWatchdog(apiKey: string, socket: WebSocket) {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      if (
        this.destroyed ||
        this.socket !== socket ||
        socket.readyState !== WebSocket.OPEN
      )
        return;

      const silenceStartedAt = this.lastDataMessageAt ?? this.lastConnectedAt;
      const silentForMs = silenceStartedAt
        ? Date.now() - silenceStartedAt.getTime()
        : this.watchdogTimeoutMs;
      this.state = 'degraded';
      this.lastError = `No AIS data received for ${Math.round(silentForMs / 1000)} seconds`;
      this.logger.warn(
        `${this.lastError}; terminating the silent socket so it can reconnect. ` +
          `AISstream can accept a WebSocket connection while its upstream feed is not delivering data.`,
      );
      socket.terminate();
    }, this.watchdogTimeoutMs);
  }

  private clearWatchdog() {
    if (!this.watchdogTimer) return;
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  private markDataReceived(apiKey: string, socket: WebSocket) {
    this.lastDataMessageAt = new Date();
    this.state = 'receiving';
    this.lastError = null;
    this.awaitingPong = false;
    this.backoffMs = INITIAL_BACKOFF_MS;
    this.rateLimitedUntil = null;
    this.rateLimitCount = 0;
    this.armWatchdog(apiKey, socket);
  }

  private async handleMessage(raw: string, apiKey: string, socket: WebSocket) {
    let envelope: AisEnvelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      this.ignoredMessageCount += 1;
      this.logger.warn('Ignored a non-JSON message from AISstream');
      return;
    }

    if (typeof envelope.error === 'string') {
      const errorMessage = envelope.error.slice(0, 500);
      this.errorMessageCount += 1;
      this.lastError = errorMessage;
      this.state = 'error';
      if (/\b429\b|rate.?limit|throttl/i.test(errorMessage)) {
        this.applyRateLimitCooldown();
      }
      this.logger.error(`AISstream rejected the subscription: ${errorMessage}`);
      socket.terminate();
      return;
    }

    const metadata = envelope.MetaData ?? envelope.Metadata;
    const mmsi = metadata?.MMSI != null ? String(metadata.MMSI) : '';
    if (!mmsi) {
      this.ignoredMessageCount += 1;
      this.logger.warn('Ignored an AISstream message without metadata MMSI');
      return;
    }

    const messageType = envelope.MessageType;
    const data = messageType ? envelope.Message?.[messageType] : undefined;

    if (
      messageType === 'PositionReport' ||
      messageType === 'StandardClassBPositionReport'
    ) {
      this.markDataReceived(apiKey, socket);
      await this.handlePositionReport(mmsi, data, metadata!);
      this.processedMessageCount += 1;
      return;
    }

    if (messageType === 'ExtendedClassBPositionReport') {
      this.markDataReceived(apiKey, socket);
      await this.handlePositionReport(mmsi, data, metadata!);
      await this.handleShipStaticData(mmsi, data, metadata!);
      this.processedMessageCount += 1;
      return;
    }

    if (messageType === 'ShipStaticData') {
      this.markDataReceived(apiKey, socket);
      await this.handleShipStaticData(mmsi, data, metadata!);
      this.processedMessageCount += 1;
      return;
    }

    if (messageType === 'StaticDataReport') {
      this.markDataReceived(apiKey, socket);
      await this.handleShipStaticData(
        mmsi,
        {
          Name: data?.ReportA?.Name,
          CallSign: data?.ReportB?.CallSign,
          Type: data?.ReportB?.ShipType,
          Dimension: data?.ReportB?.Dimension,
        },
        metadata!,
      );
      this.processedMessageCount += 1;
      return;
    }

    this.ignoredMessageCount += 1;
  }

  private async getOrCreateVessel(
    mmsi: string,
    name?: string | null,
  ): Promise<Vessel> {
    const existing = await this.vesselRepo.findOneBy({ mmsi });
    if (existing) return existing;
    return this.vesselRepo.create({ mmsi, name: name ?? null });
  }

  private async handlePositionReport(
    mmsi: string,
    pos: any,
    meta: AisMetaData,
  ) {
    if (pos?.Latitude == null || pos?.Longitude == null) return;
    const vessel = await this.getOrCreateVessel(mmsi, meta.ShipName);
    vessel.lastLat = pos.Latitude;
    vessel.lastLon = pos.Longitude;
    vessel.lastSpeedKn =
      typeof pos.Sog === 'number' ? pos.Sog : vessel.lastSpeedKn;
    vessel.lastCourseDeg =
      typeof pos.Cog === 'number' ? pos.Cog : vessel.lastCourseDeg;
    vessel.lastNavStatus =
      pos.NavigationalStatus != null
        ? String(pos.NavigationalStatus)
        : vessel.lastNavStatus;
    vessel.lastPositionAt = meta.time_utc
      ? new Date(meta.time_utc)
      : new Date();
    await this.vesselRepo.save(vessel);

    await this.voyageDetection.handlePosition(
      vessel,
      pos.Latitude,
      pos.Longitude,
      vessel.lastPositionAt,
    );
  }

  private async handleShipStaticData(
    mmsi: string,
    data: any,
    meta: AisMetaData,
  ) {
    const vessel = await this.getOrCreateVessel(
      mmsi,
      data?.Name ?? meta.ShipName,
    );

    vessel.imo = data?.ImoNumber ? String(data.ImoNumber) : vessel.imo;
    vessel.callsign = data?.CallSign || vessel.callsign;
    vessel.name = data?.Name || meta.ShipName || vessel.name;
    vessel.lastStaticDataAt = meta.time_utc
      ? new Date(meta.time_utc)
      : new Date();
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
      if (typeof A === 'number' && typeof B === 'number')
        vessel.lengthM = A + B;
      if (typeof C === 'number' && typeof D === 'number') vessel.beamM = C + D;
      if (vessel.lengthM && vessel.beamM) {
        const cap = estimateCapacity(vessel.lengthM, vessel.beamM);
        vessel.estimatedTeu = cap.estimatedTeu;
        vessel.estimatedCapacityCbm = cap.estimatedCapacityCbm;
        vessel.capacityEstimateJustification = cap.justification;
      }
    }

    if (
      typeof data?.MaximumStaticDraught === 'number' &&
      data.MaximumStaticDraught > 0
    ) {
      const draught = data.MaximumStaticDraught;
      vessel.lastDraughtM = draught;
      vessel.minDraughtM =
        vessel.minDraughtM == null
          ? draught
          : Math.min(vessel.minDraughtM, draught);
      vessel.maxDraughtM =
        vessel.maxDraughtM == null
          ? draught
          : Math.max(vessel.maxDraughtM, draught);
      const fullness = computeFullness(
        vessel.minDraughtM,
        vessel.maxDraughtM,
        vessel.lastDraughtM,
      );
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
