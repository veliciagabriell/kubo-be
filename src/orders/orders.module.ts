import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Container } from '../matching/entities/container.entity';
import { Shipment } from '../shipments/entities/shipment.entity';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Container, Shipment])],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
