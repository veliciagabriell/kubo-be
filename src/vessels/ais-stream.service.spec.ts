import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import WebSocket from 'ws';
import { AisStreamService } from './ais-stream.service';
import { Vessel } from './entities/vessel.entity';
import { VoyageDetectionService } from './voyage-detection.service';

describe('AisStreamService', () => {
  const originalApiKey = process.env.AISSTREAM_API_KEY;
  let vesselRepo: jest.Mocked<
    Pick<Repository<Vessel>, 'findOneBy' | 'create' | 'save'>
  >;
  let voyageDetection: jest.Mocked<
    Pick<VoyageDetectionService, 'handlePosition'>
  >;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emitAsync'>>;
  let service: AisStreamService;

  beforeEach(() => {
    jest.useFakeTimers();
    delete process.env.AISSTREAM_API_KEY;
    vesselRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value as Vessel),
      save: jest.fn(async (value) => value as Vessel),
    };
    voyageDetection = {
      handlePosition: jest.fn().mockResolvedValue(undefined),
    };
    eventEmitter = {
      emitAsync: jest.fn().mockResolvedValue([]),
    };
    service = new AisStreamService(
      vesselRepo as unknown as Repository<Vessel>,
      voyageDetection as unknown as VoyageDetectionService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    if (originalApiKey == null) delete process.env.AISSTREAM_API_KEY;
    else process.env.AISSTREAM_API_KEY = originalApiKey;
  });

  it('reports disabled when no API key is configured', () => {
    service.onModuleInit();

    expect(service.getHealthStatus()).toMatchObject({
      enabled: false,
      connected: false,
      healthy: false,
      state: 'disabled',
      messageCount: 0,
    });
    expect(service.getHealthStatus().subscribedMessageTypes).toEqual(
      expect.arrayContaining([
        'PositionReport',
        'StandardClassBPositionReport',
        'ExtendedClassBPositionReport',
        'ShipStaticData',
        'StaticDataReport',
      ]),
    );
  });

  it('surfaces AISstream subscription errors instead of silently ignoring them', async () => {
    const socket = { terminate: jest.fn() } as unknown as WebSocket;

    await (service as any).handleMessage(
      JSON.stringify({ error: 'Api Key Is Not Valid' }),
      'redacted-key',
      socket,
    );

    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(service.getHealthStatus()).toMatchObject({
      state: 'error',
      errorMessageCount: 1,
      lastError: 'Api Key Is Not Valid',
    });
  });

  it('tracks and processes valid AIS position messages', async () => {
    const socket = {} as WebSocket;

    await (service as any).handleMessage(
      JSON.stringify({
        MessageType: 'PositionReport',
        MetaData: {
          MMSI: 525000001,
          ShipName: 'TEST',
          time_utc: '2026-08-08T08:00:00Z',
        },
        Message: {
          PositionReport: {
            Latitude: -6.95,
            Longitude: 110.42,
            Sog: 4.2,
            Cog: 90,
            NavigationalStatus: 5,
          },
        },
      }),
      'redacted-key',
      socket,
    );

    expect(vesselRepo.save).toHaveBeenCalledTimes(1);
    expect(voyageDetection.handlePosition).toHaveBeenCalledTimes(1);
    expect(service.getHealthStatus()).toMatchObject({
      state: 'receiving',
      processedMessageCount: 1,
    });
    expect(service.getHealthStatus().lastDataMessageAt).not.toBeNull();
  });

  it('accepts Class B reports and the Metadata spelling used by some AISstream payloads', async () => {
    const socket = {} as WebSocket;

    await (service as any).handleMessage(
      JSON.stringify({
        MessageType: 'StandardClassBPositionReport',
        Metadata: { MMSI: 525000002, ShipName: 'CLASS B TEST' },
        Message: {
          StandardClassBPositionReport: {
            Latitude: -7.2,
            Longitude: 112.73,
            Sog: 2.5,
            Cog: 45,
          },
        },
      }),
      'redacted-key',
      socket,
    );

    expect(vesselRepo.save).toHaveBeenCalledTimes(1);
    expect(voyageDetection.handlePosition).toHaveBeenCalledTimes(1);
    expect(service.getHealthStatus().processedMessageCount).toBe(1);
  });

  it('uses a cooldown after AISstream rate limiting', () => {
    (service as any).applyRateLimitCooldown();

    expect(service.getHealthStatus().rateLimitedUntil).not.toBeNull();
    expect(service.getHealthStatus().rateLimitCount).toBe(1);
    expect((service as any).reconnectDelayMs()).toBeGreaterThanOrEqual(300_000);

    jest.advanceTimersByTime(300_001);
    (service as any).applyRateLimitCooldown();
    expect(service.getHealthStatus().rateLimitCount).toBe(2);
    expect((service as any).reconnectDelayMs()).toBeGreaterThanOrEqual(600_000);
  });

  it('terminates a socket that stops answering heartbeat pings', () => {
    const socket = {
      readyState: WebSocket.OPEN,
      ping: jest.fn(),
      terminate: jest.fn(),
      close: jest.fn(),
    } as unknown as WebSocket;
    (service as any).socket = socket;

    (service as any).startHeartbeat(socket);
    jest.advanceTimersByTime(HEARTBEAT_TEST_WINDOW_MS);

    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(service.getHealthStatus()).toMatchObject({
      state: 'degraded',
      lastError: 'AISstream WebSocket heartbeat timed out',
    });
  });

  it('marks a silent open socket degraded and terminates it for reconnect', () => {
    const socket = {
      readyState: WebSocket.OPEN,
      terminate: jest.fn(),
      close: jest.fn(),
    } as unknown as WebSocket;
    (service as any).socket = socket;
    (service as any).connected = true;
    (service as any).lastConnectedAt = new Date();

    (service as any).armWatchdog('redacted-key', socket);
    jest.advanceTimersByTime(service.getHealthStatus().watchdogTimeoutMs);

    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(service.getHealthStatus()).toMatchObject({
      state: 'degraded',
      healthy: false,
    });
  });
});

const HEARTBEAT_TEST_WINDOW_MS = 60_000;
