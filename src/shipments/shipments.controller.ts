import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { ShipmentsService } from './shipments.service';

@ApiTags('Shipments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Buat pengiriman baru' })
  async createShipment(
    @CurrentUser() user: User,
    @Body() dto: CreateShipmentDto,
  ) {
    const shipment = await this.shipmentsService.createShipment(user, dto);
    return { message: 'Shipment created successfully', data: shipment };
  }

  @Get()
  @ApiOperation({ summary: 'Daftar semua pengiriman milik user' })
  async getMyShipments(@CurrentUser() user: User) {
    const shipments = await this.shipmentsService.getUserShipments(user.id);
    return { data: shipments };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail pengiriman berdasarkan ID atau kode' })
  async getShipment(@CurrentUser() user: User, @Param('id') id: string) {
    const shipment = await this.shipmentsService.getShipmentById(id, user.id);
    return { data: shipment };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Perbarui status, tindakan, atau informasi kargo pengiriman',
  })
  async updateShipment(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateShipmentDto,
  ) {
    const shipment = await this.shipmentsService.updateShipment(
      id,
      user.id,
      dto,
    );
    return { message: 'Shipment updated successfully', data: shipment };
  }
}
