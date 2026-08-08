import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AisStreamService } from './vessels/ais-stream.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly aisStreamService: AisStreamService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'kubo-api',
      timestamp: new Date().toISOString(),
      integrations: {
        aisstream: this.aisStreamService.getHealthStatus(),
      },
    };
  }
}
