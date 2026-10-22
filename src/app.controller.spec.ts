import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AisStreamService } from './vessels/ais-stream.service';
import { DatabaseHealthService } from './database/database-health.service';
import { SupabaseStorageService } from './supabase/supabase-storage.service';
import { DocumentProcessingQueueService } from './documents/document-processing-queue.service';
import { DocumentParserService } from './documents/document-parser.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: AisStreamService,
          useValue: {
            getHealthStatus: jest.fn().mockReturnValue({
              enabled: false,
              connected: false,
              healthy: false,
              state: 'disabled',
            }),
          },
        },
        {
          provide: DatabaseHealthService,
          useValue: {
            getStatus: jest.fn().mockResolvedValue({
              healthy: true,
              driver: 'better-sqlite3',
              latencyMs: 0,
            }),
          },
        },
        {
          provide: SupabaseStorageService,
          useValue: {
            getStatus: jest.fn().mockReturnValue({
              healthy: true,
              provider: 'local',
              bucket: null,
              signedUrlTtlSeconds: null,
            }),
          },
        },
        {
          provide: DocumentProcessingQueueService,
          useValue: {
            getStatus: jest.fn().mockReturnValue({
              provider: 'in-process',
              ready: false,
              callbackConfigured: false,
            }),
          },
        },
        {
          provide: DocumentParserService,
          useValue: {
            getStatus: jest.fn().mockReturnValue({
              provider: 'gemini',
              ready: true,
              model: 'gemini-flash-latest',
            }),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
