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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateOrderDto, OrderListQueryDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout/preview')
  @ApiOperation({
    summary: 'Preview biaya checkout sebelum konfirmasi pembayaran',
  })
  async checkoutPreview(@Body() dto: CreateOrderDto) {
    return this.ordersService.getCheckoutPreview(dto);
  }

  @Post('checkout/confirm')
  @ApiOperation({
    summary: 'Konfirmasi & bayar – buat order baru dan kurangi kapasitas container',
  })
  async confirmAndPay(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    const order = await this.ordersService.createOrder(user.id, dto);
    return {
      message: 'Payment confirmed. Order created successfully.',
      data: order,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Daftar semua order milik user (Shipments & Payments)' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'completed', 'refunded'] })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2024-01-01' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2024-12-31' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  async getMyOrders(
    @CurrentUser() user: User,
    @Query() query: OrderListQueryDto,
  ) {
    return this.ordersService.getUserOrders(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail order berdasarkan ID' })
  async getOrder(@CurrentUser() user: User, @Param('id') id: string) {
    const order = await this.ordersService.getOrderById(id, user.id);
    return { data: order };
  }
}
