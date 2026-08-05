import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum VoyageStatus {
  /** Detected elsewhere in the wider AIS region, already broadcasting an ID origin port as destination, but not yet inside that port's geofence. */
  INBOUND = 'INBOUND',
  AWAITING_DEPARTURE = 'AWAITING_DEPARTURE',
  DEPARTED = 'DEPARTED',
  ARRIVED = 'ARRIVED',
  STALE = 'STALE',
}

export type DestinationConfidence = 'guessed_from_ais_text' | 'confirmed_by_geofence';

/**
 * A detected Indonesia -> Japan voyage for one vessel, built entirely from
 * observed AIS geofence transitions (see VoyageDetectionService). Nothing
 * here is scheduled/seeded - a Voyage only exists once real AIS traffic
 * produced it.
 */
@Entity('voyages')
export class Voyage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vessel_mmsi', type: 'varchar' })
  vesselMmsi: string;

  @Column({ name: 'origin_port_id', type: 'varchar' })
  originPortId: string;

  @Column({ name: 'origin_port_label', type: 'varchar' })
  originPortLabel: string;

  @Column({ name: 'departed_at', type: 'datetime', nullable: true })
  departedAt: Date | null;

  @Column({ name: 'destination_port_id', type: 'varchar', nullable: true })
  destinationPortId: string | null;

  @Column({ name: 'destination_port_label', type: 'varchar', nullable: true })
  destinationPortLabel: string | null;

  @Column({ name: 'destination_confidence', type: 'varchar', nullable: true })
  destinationConfidence: DestinationConfidence | null;

  @Column({ type: 'varchar', default: VoyageStatus.AWAITING_DEPARTURE })
  status: VoyageStatus;

  @Column({ name: 'arrived_at', type: 'datetime', nullable: true })
  arrivedAt: Date | null;

  @Column({ name: 'last_seen_at', type: 'datetime' })
  lastSeenAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
