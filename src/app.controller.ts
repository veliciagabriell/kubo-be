import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AisStreamService } from './vessels/ais-stream.service';
import { DatabaseHealthService } from './database/database-health.service';
import { SupabaseStorageService } from './supabase/supabase-storage.service';
import { DocumentProcessingQueueService } from './documents/document-processing-queue.service';
import { DocumentParserService } from './documents/document-parser.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly aisStreamService: AisStreamService,
    private readonly databaseHealthService: DatabaseHealthService,
    private readonly storageService: SupabaseStorageService,
    private readonly documentQueue: DocumentProcessingQueueService,
    private readonly documentParser: DocumentParserService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth() {
    const database = await this.databaseHealthService.getStatus();
    const storage = this.storageService.getStatus();
    return {
      status: database.healthy && storage.healthy ? 'ok' : 'degraded',
      service: 'kubo-api',
      timestamp: new Date().toISOString(),
      integrations: {
        database,
        storage,
        documentQueue: this.documentQueue.getStatus(),
        documentParser: this.documentParser.getStatus(),
        aisstream: this.aisStreamService.getHealthStatus(),
      },
    };
  }
}
