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
import { User } from '../users/entities/user.entity';
import { Container } from '../matching/entities/container.entity';
import { Vessel } from '../vessels/entities/vessel.entity';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { DocumentParserService } from './document-parser.service';
import { DocumentExtractorService } from './document-extractor.service';
import { DocumentProcessingQueueService } from './document-processing-queue.service';
import { DocumentAssistantService } from './document-assistant.service';
import { CanonicalShipmentService } from './canonical/canonical-shipment.service';
import { DocumentGenerationService } from './generation/document-generation.service';
import { DocxTemplateRenderer } from './renderers/docx-template.renderer';
import { TemplatePdfRenderer } from './renderers/template-pdf.renderer';
import { DocumentTemplateRegistry } from './templates/document-template.registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      ExtractedField,
      ShipmentFact,
      Shipment,
      User,
      Container,
      Vessel,
    ]),
  ],
  controllers: [DocumentsController, DocumentIntelligenceController],
  providers: [
    DocumentsService,
    DocumentIntelligenceService,
    DocumentParserService,
    DocumentExtractorService,
    DocumentProcessingQueueService,
    DocumentAssistantService,
    CanonicalShipmentService,
    DocumentGenerationService,
    DocxTemplateRenderer,
    TemplatePdfRenderer,
    DocumentTemplateRegistry,
  ],
  exports: [
    DocumentIntelligenceService,
    DocumentAssistantService,
    DocumentGenerationService,
  ],
})
export class DocumentsModule {}
