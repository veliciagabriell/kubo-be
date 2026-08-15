import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Vessel } from '../vessels/entities/vessel.entity';
import { Voyage } from '../vessels/entities/voyage.entity';
import { AiMatchingService } from './ai-matching.service';
import { Container } from './entities/container.entity';
import { DevelopmentMatchingFixtureService } from './development-matching-fixture.service';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

@Module({
  // Vessel and Voyage are read-only here (live vessel identity/fullness
  // lookups at view-build time, and re-checking an already-open voyage once
  // late-arriving AIS static data classifies its vessel) - no dependency on
  // VesselsModule itself, container creation/updates are driven by
  // `voyage.*`/`vessel.*` events instead (see MatchingService), keeping the
  // two modules decoupled.
  imports: [TypeOrmModule.forFeature([Container, Vessel, Voyage, User])],
  controllers: [MatchingController],
  providers: [
    MatchingService,
    AiMatchingService,
    DevelopmentMatchingFixtureService,
  ],
  exports: [MatchingService],
})
export class MatchingModule {}
