import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../documents/entities/document.entity';
import { ExtractedField } from '../documents/entities/extracted-field.entity';
import { Container } from '../matching/entities/container.entity';
import { Order } from '../orders/entities/order.entity';
import { Shipment } from '../shipments/entities/shipment.entity';
import { ForwarderController } from './forwarder.controller';
import { ForwarderService } from './forwarder.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Shipment,
      Container,
      Order,
      Document,
      ExtractedField,
    ]),
  ],
  controllers: [ForwarderController],
  providers: [ForwarderService],
})
export class ForwarderModule {}
