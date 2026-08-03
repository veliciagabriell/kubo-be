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

  @Column({ type: 'varchar' })
  type: DocumentType;

  @Column({ type: 'text' })
  fields: string;

  @Column({ type: 'text', nullable: true })
  items: string | null;

  @Column({ name: 'generated_content', type: 'text', nullable: true })
  generatedContent: string | null;

  @Column({ name: 'file_url', type: 'varchar', nullable: true })
  fileUrl: string | null;

  @Column({ default: 'draft' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
