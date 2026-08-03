import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from './entities/document.entity';
import {
  DocumentIntelligenceController,
  DocumentsController,
} from './documents.controller';
import { DocumentsService } from './documents.service';
import { ExtractedField } from './entities/extracted-field.entity';
import { ShipmentFact } from './entities/shipment-fact.entity';
import { Shipment } from '../shipments/entities/shipment.entity';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { DocumentParserService } from './document-parser.service';
import { DocumentExtractorService } from './document-extractor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      ExtractedField,
      ShipmentFact,
      Shipment,
    ]),
  ],
  controllers: [DocumentsController, DocumentIntelligenceController],
  providers: [
    DocumentsService,
    DocumentIntelligenceService,
    DocumentParserService,
    DocumentExtractorService,
  ],
  exports: [DocumentIntelligenceService],
})
export class DocumentsModule {}
