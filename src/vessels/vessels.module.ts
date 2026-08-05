import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AisStreamService } from './ais-stream.service';
import { Vessel } from './entities/vessel.entity';
import { Voyage } from './entities/voyage.entity';
import { VesselsController } from './vessels.controller';
import { VesselsService } from './vessels.service';
import { VoyageDetectionService } from './voyage-detection.service';

@Module({
  imports: [TypeOrmModule.forFeature([Vessel, Voyage])],
  controllers: [VesselsController],
  providers: [AisStreamService, VoyageDetectionService, VesselsService],
  exports: [VesselsService],
})
export class VesselsModule {}
