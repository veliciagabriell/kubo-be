import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Document } from './document.entity';

@Entity('extracted_fields')
export class ExtractedField {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column()
  field: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'varchar', nullable: true })
  unit: string | null;

  @Column({ type: 'real' })
  confidence: number;

  @Column({ name: 'file_id' })
  fileId: string;

  @Column({ name: 'file_version', type: 'integer' })
  fileVersion: number;

  @Column({ name: 'page_number', type: 'integer', nullable: true })
  pageNumber: number | null;

  @Column({ name: 'raw_text', type: 'text', nullable: true })
  rawText: string | null;

  @Column({ name: 'bounding_box', type: 'text', nullable: true })
  boundingBox: string | null;

  @Column({ name: 'extraction_method' })
  extractionMethod: string;

  @Column({ name: 'parser_model' })
  parserModel: string;

  @Column({ name: 'is_corrected', default: false })
  isCorrected: boolean;

  @Column({ name: 'original_value', type: 'text', nullable: true })
  originalValue: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
