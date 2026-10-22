import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { ForwarderModule } from './forwarder/forwarder.module';
import { UsersModule } from './users/users.module';
import { Vessel } from './vessels/entities/vessel.entity';
import { Voyage } from './vessels/entities/voyage.entity';
import { VesselsModule } from './vessels/vessels.module';
import { SupabaseModule } from './supabase/supabase.module';
import { DatabaseHealthService } from './database/database-health.service';

const entities = [
  User,
  Document,
  ExtractedField,
  ShipmentFact,
  Container,
  Order,
  Shipment,
  Vessel,
  Voyage,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl = config.get<string>('DATABASE_URL');
        const synchronize = config.get<string>('DB_SYNCHRONIZE') === 'true';

        if (databaseUrl) {
          if (databaseUrl.includes('[YOUR-PASSWORD]')) {
            throw new Error(
              'DATABASE_URL masih memakai placeholder [YOUR-PASSWORD]. Ganti dengan password database Supabase yang sudah di-percent-encode.',
            );
          }

          const poolSize = Number(config.get<string>('DB_POOL_SIZE', '1'));
          if (!Number.isInteger(poolSize) || poolSize < 1) {
            throw new Error(
              'DB_POOL_SIZE harus berupa bilangan bulat minimal 1.',
            );
          }

          return {
            type: 'postgres' as const,
            url: databaseUrl,
            entities,
            synchronize,
            ssl:
              config.get<string>('DATABASE_SSL', 'true') === 'true'
                ? { rejectUnauthorized: false }
                : false,
            extra: {
              max: poolSize,
            },
          };
        }

        return {
          type: 'better-sqlite3' as const,
          database: config.get<string>('DB_PATH', 'kubo.db'),
          entities,
          synchronize: config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
        };
      },
    }),
    SupabaseModule,
    AuthModule,
    UsersModule,
    DocumentsModule,
    VesselsModule,
    MatchingModule,
    OrdersModule,
    ShipmentsModule,
    ForwarderModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseHealthService],
})
export class AppModule {}
