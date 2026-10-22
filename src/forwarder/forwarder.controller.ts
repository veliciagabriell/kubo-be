import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ForwarderService } from './forwarder.service';

@ApiTags('Freight Forwarder')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('forwarder')
export class ForwarderController {
  constructor(private readonly forwarderService: ForwarderService) {}

  @Get('customers')
  @ApiOperation({
    summary: 'Shipment berbayar pada container milik Freight Forwarder',
  })
  async getConfirmedCustomers(@CurrentUser() user: User) {
    return { data: await this.forwarderService.getConfirmedCustomers(user) };
  }

  @Get('customers/:shipmentId')
  @ApiOperation({
    summary: 'Detail shipment pelanggan yang dapat diakses Freight Forwarder',
  })
  async getCustomerShipment(
    @CurrentUser() user: User,
    @Param('shipmentId') shipmentId: string,
  ) {
    return {
      data: await this.forwarderService.getCustomerShipment(user, shipmentId),
    };
  }
}
