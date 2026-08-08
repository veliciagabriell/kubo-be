import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum DocumentType {
  SVLK = 'SVLK',
  PEB = 'PEB',
  CERTIFICATE_OF_ORIGIN = 'CERTIFICATE_OF_ORIGIN',
  COMMERCIAL_INVOICE = 'COMMERCIAL_INVOICE',
  PACKING_LIST = 'PACKING_LIST',
  BILL_OF_LADING = 'BILL_OF_LADING',
}

export enum ProcessingStatus {
  UPLOADED = 'uploaded',
  QUEUED = 'queued',
  PARSING = 'parsing',
  OCR_PROCESSING = 'ocr_processing',
  CLASSIFYING = 'classifying',
  EXTRACTING = 'extracting',
  COMPLETED = 'completed',
  NEEDS_REVIEW = 'needs_review',
  FAILED = 'failed',
}

export enum FileInspectionStatus {
  VALID = 'valid',
  UNSUPPORTED = 'unsupported',
  CORRUPTED = 'corrupted',
  TOO_LARGE = 'too_large',
  DUPLICATE = 'duplicate',
}

export enum DocumentOrigin {
  UPLOADED = 'uploaded',
  GENERATED = 'generated',
  EXTERNAL = 'external',
}

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'shipment_id', type: 'varchar', nullable: true })
  shipmentId: string | null;

  @Column({ type: 'varchar', nullable: true })
  type: DocumentType | null;

  @Column({ type: 'text', default: '{}' })
  fields: string;

  @Column({ type: 'text', nullable: true })
  items: string | null;

  @Column({ name: 'generated_content', type: 'text', nullable: true })
  generatedContent: string | null;

  @Column({
    name: 'document_origin',
    type: 'varchar',
    default: DocumentOrigin.UPLOADED,
  })
  documentOrigin: DocumentOrigin;

  @Column({ name: 'template_version', type: 'varchar', nullable: true })
  templateVersion: string | null;

  @Column({ name: 'shipment_snapshot_id', type: 'varchar', nullable: true })
  shipmentSnapshotId: string | null;

  @Column({ name: 'generated_at', type: 'datetime', nullable: true })
  generatedAt: Date | null;

  @Column({ name: 'generated_by', type: 'varchar', nullable: true })
  generatedBy: string | null;

  @Column({ name: 'generated_sources', type: 'text', nullable: true })
  generatedSources: string | null;

  @Column({ name: 'file_url', type: 'varchar', nullable: true })
  fileUrl: string | null;

  @Column({ name: 'docx_file_url', type: 'varchar', nullable: true })
  docxFileUrl: string | null;

  @Column({ default: 'draft' })
  status: string;

  @Column({ name: 'original_file_name', type: 'varchar', nullable: true })
  originalFileName: string | null;

  @Column({ name: 'mime_type', type: 'varchar', nullable: true })
  mimeType: string | null;

  @Column({ name: 'file_size', type: 'integer', nullable: true })
  fileSize: number | null;

  @Column({ name: 'sha256', type: 'varchar', nullable: true })
  sha256: string | null;

  @Column({ name: 'file_version', type: 'integer', default: 1 })
  fileVersion: number;

  @Column({ name: 'inspection_status', type: 'varchar', nullable: true })
  inspectionStatus: FileInspectionStatus | null;

  @Column({ name: 'processing_status', type: 'varchar', nullable: true })
  processingStatus: ProcessingStatus | null;

  @Column({ name: 'page_count', type: 'integer', nullable: true })
  pageCount: number | null;

  @Column({ name: 'has_text_layer', type: 'boolean', nullable: true })
  hasTextLayer: boolean | null;

  @Column({ name: 'classification_confidence', type: 'real', nullable: true })
  classificationConfidence: number | null;

  @Column({ name: 'classification_method', type: 'varchar', nullable: true })
  classificationMethod: string | null;

  @Column({ name: 'declared_document_type', type: 'varchar', nullable: true })
  declaredDocumentType: DocumentType | null;

  @Column({ name: 'parser_name', type: 'varchar', nullable: true })
  parserName: string | null;

  @Column({ name: 'raw_text', type: 'text', nullable: true })
  rawText: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'duplicate_of_id', type: 'varchar', nullable: true })
  duplicateOfId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
