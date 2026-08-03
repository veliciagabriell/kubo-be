import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('shipment_facts')
@Index(['shipmentId', 'field'], { unique: true })
export class ShipmentFact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shipment_id' })
  shipmentId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  field: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'varchar', nullable: true })
  unit: string | null;

  @Column({ type: 'real' })
  confidence: number;

  @Column({ name: 'source_field_id', type: 'varchar', nullable: true })
  sourceFieldId: string | null;

  @Column({ name: 'is_user_verified', default: false })
  isUserVerified: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
