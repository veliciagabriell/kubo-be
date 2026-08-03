import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

export enum ContainerType {
  TWENTY_FT = '20ft',
  FORTY_FT = '40ft',
  FORTY_FT_HC = '40ft HC',
}

@Entity('containers')
export class Container {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'destination_country', default: 'Japan' })
  destinationCountry: string;

  @Column({ name: 'destination_city' })
  destinationCity: string;

  @Column({ name: 'origin_port', default: 'Tanjung Emas, Semarang' })
  originPort: string;

  @Column({ name: 'container_type', type: 'varchar' })
  containerType: ContainerType;

  @Column({ name: 'total_capacity_cbm', type: 'real' })
  totalCapacityCbm: number;

  @Column({ name: 'current_used_cbm', type: 'real', default: 0 })
  currentUsedCbm: number;

  @Column({ name: 'departure_date' })
  departureDate: string;

  @Column({ name: 'cargo_cutoff_date', type: 'varchar', nullable: true })
  cargoCutoffDate: string | null;

  @Column({ name: 'document_cutoff_date', type: 'varchar', nullable: true })
  documentCutoffDate: string | null;

  @Column({ name: 'transit_days', type: 'integer', default: 17 })
  transitDays: number;

  @Column({ name: 'forwarder_name', type: 'varchar', nullable: true })
  forwarderName: string | null;

  @Column({ name: 'forwarder_verified', default: true })
  forwarderVerified: boolean;

  @Column({ name: 'forwarder_rating', type: 'real', default: 4.7 })
  forwarderRating: number;

  @Column({ name: 'forwarder_completed_shipments', type: 'integer', default: 50 })
  forwarderCompletedShipments: number;

  @Column({ name: 'cost_per_cbm', type: 'integer' })
  costPerCbm: number;

  @Column({ default: 'open' })
  status: string;

  @Column({ name: 'umkm_count', default: 0 })
  umkmCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
