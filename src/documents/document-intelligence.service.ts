import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Shipment } from '../shipments/entities/shipment.entity';
import { CorrectExtractedFieldDto } from './dto/correct-extracted-field.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import {
  Document,
  FileInspectionStatus,
  ProcessingStatus,
} from './entities/document.entity';
import { ExtractedField } from './entities/extracted-field.entity';
import { ShipmentFact } from './entities/shipment-fact.entity';
import { DocumentExtractorService } from './document-extractor.service';
import { DocumentParserService } from './document-parser.service';
import { DocumentProcessingQueueService } from './document-processing-queue.service';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
  '.docx',
  '.xlsx',
  '.csv',
]);

@Injectable()
export class DocumentIntelligenceService implements OnModuleInit {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(ExtractedField)
    private readonly fieldRepo: Repository<ExtractedField>,
    @InjectRepository(ShipmentFact)
    private readonly factRepo: Repository<ShipmentFact>,
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    private readonly parser: DocumentParserService,
    private readonly extractor: DocumentExtractorService,
    private readonly processingQueue: DocumentProcessingQueueService,
  ) {}

  onModuleInit(): void {
    this.processingQueue.registerProcessor((documentId) =>
      this.process(documentId),
    );
  }

  async upload(
    userId: string,
    shipmentId: string,
    file: Express.Multer.File | undefined,
    dto: UploadDocumentDto,
  ) {
    if (!file) throw new BadRequestException('File wajib diunggah');
    const shipment = await this.findOwnedShipment(shipmentId, userId);
    if (!shipment) throw new NotFoundException('Shipment not found');

    const inspection = this.inspect(file);
    if (inspection !== FileInspectionStatus.VALID) {
      throw new BadRequestException(`File inspection failed: ${inspection}`);
    }
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.documentRepo.findOne({
      where: { userId, shipmentId: shipment.id, sha256: hash },
      order: { createdAt: 'ASC' },
    });
    if (duplicate) {
      return {
        ...this.toDocumentResult(duplicate),
        inspectionStatus: FileInspectionStatus.DUPLICATE,
        duplicateOfId: duplicate.id,
        idempotentReplay: true,
      };
    }

    const uploadDir = join(process.cwd(), 'uploads', 'source-documents');
    await mkdir(uploadDir, { recursive: true });
    const storedName = `${randomUUID()}${extname(file.originalname).toLowerCase()}`;
    const filePath = join(uploadDir, storedName);
    await writeFile(filePath, file.buffer);

    const document = await this.documentRepo.save(
      this.documentRepo.create({
        userId,
        shipmentId: shipment.id,
        type: dto.declaredDocumentType ?? null,
        declaredDocumentType: dto.declaredDocumentType ?? null,
        fields: '{}',
        items: null,
        generatedContent: null,
        fileUrl: `/uploads/source-documents/${storedName}`,
        status: 'uploaded',
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        sha256: hash,
        fileVersion: 1,
        inspectionStatus: FileInspectionStatus.VALID,
        processingStatus: ProcessingStatus.QUEUED,
      }),
    );

    await this.processingQueue.enqueue(document.id);
    return { ...this.toDocumentResult(document), idempotentReplay: false };
  }

  async process(documentId: string): Promise<void> {
    const document = await this.documentRepo.findOne({
      where: { id: documentId },
    });
    if (!document?.fileUrl || !document.originalFileName || !document.mimeType)
      return;
    try {
      document.processingStatus = ProcessingStatus.PARSING;
      document.errorMessage = null;
      await this.documentRepo.save(document);
      const buffer = await readFile(
        join(process.cwd(), document.fileUrl.replace(/^\//, '')),
      );
      const parsed = await this.parser.parse(
        buffer,
        document.originalFileName,
        document.mimeType,
      );
      document.processingStatus = parsed.usedOcr
        ? ProcessingStatus.OCR_PROCESSING
        : ProcessingStatus.CLASSIFYING;
      document.pageCount = parsed.pages;
      document.hasTextLayer = parsed.hasTextLayer;
      document.parserName = parsed.parser;
      document.rawText = parsed.text;
      await this.documentRepo.save(document);

      const classification = this.extractor.classify(
        document.originalFileName,
        parsed.text,
        document.declaredDocumentType,
      );
      document.type = classification.type;
      document.classificationConfidence = classification.confidence;
      document.classificationMethod = classification.method;
      document.processingStatus = ProcessingStatus.EXTRACTING;
      await this.documentRepo.save(document);

      await this.fieldRepo.delete({ documentId: document.id });
      const values = this.extractor.extract(parsed, classification.type);
      for (const value of values) {
        const field = await this.fieldRepo.save(
          this.fieldRepo.create({
            documentId: document.id,
            field: value.field,
            value: value.value,
            unit: value.unit,
            confidence: value.confidence,
            fileId: document.id,
            fileVersion: document.fileVersion,
            pageNumber: value.source.pageNumber,
            rawText: value.source.text,
            boundingBox: value.source.boundingBox
              ? JSON.stringify(value.source.boundingBox)
              : null,
            extractionMethod: value.method,
            parserModel: parsed.parser,
            isCorrected: false,
            originalValue: null,
          }),
        );
        if (document.shipmentId) await this.upsertFact(document, field);
      }
      document.fields = JSON.stringify(
        Object.fromEntries(values.map((value) => [value.field, value.value])),
      );
      document.processingStatus =
        classification.confidence < 0.7 || values.length === 0
          ? ProcessingStatus.NEEDS_REVIEW
          : ProcessingStatus.COMPLETED;
      document.status = document.processingStatus;
      await this.documentRepo.save(document);
    } catch (error) {
      document.processingStatus = ProcessingStatus.FAILED;
      document.status = ProcessingStatus.FAILED;
      document.errorMessage =
        error instanceof Error ? error.message : 'Unknown processing error';
      await this.documentRepo.save(document);
      throw error;
    }
  }

  async getDocument(id: string, userId: string) {
    const document = await this.findOwnedDocument(id, userId);
    return this.toDocumentResult(document);
  }

  async getExtractions(id: string, userId: string) {
    await this.findOwnedDocument(id, userId);
    const fields = await this.fieldRepo.find({
      where: { documentId: id },
      order: { createdAt: 'ASC' },
    });
    return fields.map((field) => this.toFieldResult(field));
  }

  async reprocess(id: string, userId: string) {
    const document = await this.findOwnedDocument(id, userId);
    if (!document.fileUrl)
      throw new BadRequestException(
        'Dokumen generated tidak dapat diproses ulang',
      );
    document.processingStatus = ProcessingStatus.QUEUED;
    document.status = ProcessingStatus.QUEUED;
    document.errorMessage = null;
    await this.documentRepo.save(document);
    await this.processingQueue.enqueue(document.id);
    return this.toDocumentResult(document);
  }

  async correctField(
    fieldId: string,
    userId: string,
    dto: CorrectExtractedFieldDto,
  ) {
    const field = await this.fieldRepo.findOne({
      where: { id: fieldId },
      relations: { document: true },
    });
    if (!field || field.document.userId !== userId)
      throw new NotFoundException('Extracted field not found');
    if (!field.isCorrected) field.originalValue = field.value;
    field.value = dto.value;
    field.unit = dto.unit ?? field.unit;
    field.confidence = 1;
    field.isCorrected = true;
    field.extractionMethod = 'user_correction';
    const saved = await this.fieldRepo.save(field);
    if (field.document.shipmentId)
      await this.upsertFact(field.document, saved, true);
    const allFields = await this.fieldRepo.find({
      where: { documentId: field.documentId },
    });
    field.document.fields = JSON.stringify(
      Object.fromEntries(allFields.map((item) => [item.field, item.value])),
    );
    await this.documentRepo.save(field.document);
    return this.toFieldResult(saved);
  }

  async getShipmentFacts(shipmentId: string, userId: string) {
    const shipment = await this.findOwnedShipment(shipmentId, userId);
    if (!shipment) throw new NotFoundException('Shipment not found');
    return this.factRepo.find({
      where: { shipmentId: shipment.id, userId },
      order: { field: 'ASC' },
    });
  }

  private inspect(file: Express.Multer.File): FileInspectionStatus {
    if (file.size > MAX_FILE_SIZE) return FileInspectionStatus.TOO_LARGE;
    const extension = extname(file.originalname).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension))
      return FileInspectionStatus.UNSUPPORTED;
    if (!file.buffer?.length) return FileInspectionStatus.CORRUPTED;
    const magic = file.buffer.subarray(0, 8);
    const signatures: Partial<Record<string, boolean>> = {
      '.pdf': magic.subarray(0, 5).toString() === '%PDF-',
      '.png': magic.equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
      '.jpg': magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff,
      '.jpeg': magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff,
      '.tif':
        magic.subarray(0, 4).toString('hex') === '49492a00' ||
        magic.subarray(0, 4).toString('hex') === '4d4d002a',
      '.tiff':
        magic.subarray(0, 4).toString('hex') === '49492a00' ||
        magic.subarray(0, 4).toString('hex') === '4d4d002a',
      '.docx': magic.subarray(0, 2).toString() === 'PK',
      '.xlsx': magic.subarray(0, 2).toString() === 'PK',
    };
    if (signatures[extension] === false) return FileInspectionStatus.CORRUPTED;
    return FileInspectionStatus.VALID;
  }

  private async findOwnedDocument(
    id: string,
    userId: string,
  ): Promise<Document> {
    const document = await this.documentRepo.findOne({ where: { id, userId } });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  private findOwnedShipment(shipmentId: string, userId: string) {
    const byId: FindOptionsWhere<Shipment> = { id: shipmentId, userId };
    const byCode: FindOptionsWhere<Shipment> = {
      shipmentCode: shipmentId,
      userId,
    };
    return this.shipmentRepo.findOne({ where: [byId, byCode] });
  }

  private async upsertFact(
    document: Document,
    field: ExtractedField,
    verified = false,
  ) {
    if (!document.shipmentId) return;
    const existing = await this.factRepo.findOne({
      where: { shipmentId: document.shipmentId, field: field.field },
    });
    if (existing?.isUserVerified && !verified) return;
    if (existing && existing.confidence > field.confidence && !verified) return;
    const fact =
      existing ??
      this.factRepo.create({
        shipmentId: document.shipmentId,
        userId: document.userId,
        field: field.field,
      });
    fact.value = field.value;
    fact.unit = field.unit;
    fact.confidence = field.confidence;
    fact.sourceFieldId = field.id;
    fact.isUserVerified = verified || fact.isUserVerified;
    await this.factRepo.save(fact);
  }

  private toDocumentResult(document: Document) {
    return {
      documentId: document.id,
      fileId: document.id,
      shipmentId: document.shipmentId,
      fileName: document.originalFileName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      sha256: document.sha256,
      fileVersion: document.fileVersion,
      inspectionStatus: document.inspectionStatus,
      processingStatus: document.processingStatus,
      pages: document.pageCount,
      hasTextLayer: document.hasTextLayer,
      classification: {
        type: document.type?.toLowerCase() ?? null,
        confidence: document.classificationConfidence,
        method: document.classificationMethod,
      },
      error: document.errorMessage,
      createdAt: document.createdAt,
    };
  }

  private toFieldResult(field: ExtractedField) {
    return {
      id: field.id,
      field: field.field,
      value: field.value,
      unit: field.unit,
      confidence: field.confidence,
      isCorrected: field.isCorrected,
      originalValue: field.originalValue,
      source: {
        fileId: field.fileId,
        fileVersion: field.fileVersion,
        page: field.pageNumber,
        text: field.rawText,
        boundingBox: field.boundingBox
          ? (JSON.parse(field.boundingBox) as number[])
          : null,
        extractionMethod: field.extractionMethod,
        parser: field.parserModel,
        timestamp: field.createdAt,
      },
    };
  }
}
