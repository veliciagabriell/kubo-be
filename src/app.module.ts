import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { Document } from './documents/entities/document.entity';
import { Container } from './matching/entities/container.entity';
import { MatchingModule } from './matching/matching.module';
import { Order } from './orders/entities/order.entity';
import { OrdersModule } from './orders/orders.module';
import { Shipment } from './shipments/entities/shipment.entity';
import { ShipmentsModule } from './shipments/shipments.module';
import { User } from './users/entities/user.entity';
import { ExtractedField } from './documents/entities/extracted-field.entity';
import { ShipmentFact } from './documents/entities/shipment-fact.entity';
import { UsersModule } from './users/users.module';
import { Vessel } from './vessels/entities/vessel.entity';
import { Voyage } from './vessels/entities/voyage.entity';
import { VesselsModule } from './vessels/vessels.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH || 'kubo.db',
      entities: [
        User,
        Document,
        ExtractedField,
        ShipmentFact,
        Container,
        Order,
        Shipment,
        Vessel,
        Voyage,
      ],
      synchronize: true,
    }),
    AuthModule,
    UsersModule,
    DocumentsModule,
    VesselsModule,
    MatchingModule,
    OrdersModule,
    ShipmentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
