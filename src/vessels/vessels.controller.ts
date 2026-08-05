import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VESSEL_FILTER_JUSTIFICATION } from './lib/vessel-classification';
import { VesselsService } from './vessels.service';

@ApiTags('Vessels')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class VesselsController {
  constructor(private readonly vesselsService: VesselsService) {}

  @Get('vessels')
  @ApiOperation({ summary: 'Kapal kargo besar yang terlacak secara live via AIS (AISstream.io)' })
  async listVessels() {
    const data = await this.vesselsService.listVessels();
    return { total: data.length, data, filterJustification: VESSEL_FILTER_JUSTIFICATION };
  }

  @Get('vessels/:mmsi')
  @ApiOperation({ summary: 'Detail kapal berdasarkan MMSI' })
  async getVessel(@Param('mmsi') mmsi: string) {
    return { data: await this.vesselsService.getVessel(mmsi) };
  }

  @Get('voyages')
  @ApiOperation({ summary: 'Pelayaran Indonesia -> Jepang yang terdeteksi dari AIS' })
  async listVoyages() {
    const data = await this.vesselsService.listVoyages();
    return { total: data.length, data };
  }

  @Get('voyages/:id')
  @ApiOperation({ summary: 'Detail pelayaran berdasarkan ID' })
  async getVoyage(@Param('id') id: string) {
    return { data: await this.vesselsService.getVoyage(id) };
  }
}
