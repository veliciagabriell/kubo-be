import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthService {
  constructor(private readonly dataSource: DataSource) {}

  async getStatus() {
    const startedAt = Date.now();

    try {
      await this.dataSource.query('SELECT 1');
      return {
        healthy: true,
        driver: this.dataSource.options.type,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        healthy: false,
        driver: this.dataSource.options.type,
        latencyMs: Date.now() - startedAt,
        error:
          error instanceof Error ? error.message : 'Unknown database error',
      };
    }
  }
}
