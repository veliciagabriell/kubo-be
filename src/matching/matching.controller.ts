import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MatchRequestDto } from './dto/match-request.dto';
import { MatchingService } from './matching.service';

@ApiTags('Matching')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('matching')
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get('algorithm')
  @ApiOperation({ summary: 'Penjelasan algoritma AI Smart Container Matching' })
  getAlgorithmInfo() {
    return this.matchingService.getAlgorithmInfo();
  }

  @Get('origin-ports')
  @ApiOperation({ summary: 'Jarak nyata dari Jepara ke Tanjung Emas & Tanjung Perak, dan rekomendasi terdekat' })
  getOriginPortsInfo() {
    return this.matchingService.getOriginPortsInfo();
  }

  @Get('containers')
  @ApiOperation({ summary: 'Lihat semua container yang tersedia ke Jepang' })
  @ApiQuery({ name: 'forCbm', required: false, example: 5 })
  async getAllContainers(@Query('forCbm') forCbm?: string) {
    const containers = await this.matchingService.getAllContainers(
      forCbm ? Number(forCbm) : undefined,
    );
    return { total: containers.length, data: containers };
  }

  @Get('containers/:id')
  @ApiOperation({ summary: 'Detail container berdasarkan ID' })
  @ApiQuery({ name: 'forCbm', required: false, example: 5 })
  async getContainerById(
    @Param('id') id: string,
    @Query('forCbm') forCbm?: string,
  ) {
    const container = await this.matchingService.getContainerById(
      id,
      forCbm ? Number(forCbm) : undefined,
    );
    return { data: container };
  }

  @Post('find')
  @ApiOperation({
    summary: 'Cari container optimal berdasarkan negara tujuan, volume CBM, dan tanggal',
  })
  async findMatches(@Body() dto: MatchRequestDto) {
    const results = await this.matchingService.findMatches(dto);
    return {
      total: results.length,
      request: dto,
      data: results,
    };
  }
}
