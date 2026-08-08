import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A vessel tracked via live AIS (AISstream.io), or an explicitly labelled
 * development fixture when MATCHING_FIXTURE_ENABLED is active. dataSource
 * prevents fixture values from being mistaken for live AIS observations.
 */
@Entity('vessels')
export class Vessel {
  @PrimaryColumn({ type: 'varchar' })
  mmsi: string;

  @Column({ name: 'data_source', type: 'varchar', default: 'live_ais' })
  dataSource: 'live_ais' | 'development_fixture';

  @Column({ type: 'varchar', nullable: true })
  imo: string | null;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'varchar', nullable: true })
  callsign: string | null;

  @Column({ name: 'ship_type_code', type: 'integer', nullable: true })
  shipTypeCode: number | null;

  @Column({ name: 'ship_type_label', type: 'varchar', nullable: true })
  shipTypeLabel: string | null;

  @Column({ name: 'length_m', type: 'real', nullable: true })
  lengthM: number | null;

  @Column({ name: 'beam_m', type: 'real', nullable: true })
  beamM: number | null;

  @Column({ name: 'estimated_teu', type: 'real', nullable: true })
  estimatedTeu: number | null;

  @Column({ name: 'estimated_capacity_cbm', type: 'real', nullable: true })
  estimatedCapacityCbm: number | null;

  @Column({
    name: 'capacity_estimate_justification',
    type: 'text',
    nullable: true,
  })
  capacityEstimateJustification: string | null;

  @Column({ name: 'min_draught_m', type: 'real', nullable: true })
  minDraughtM: number | null;

  @Column({ name: 'max_draught_m', type: 'real', nullable: true })
  maxDraughtM: number | null;

  @Column({ name: 'last_draught_m', type: 'real', nullable: true })
  lastDraughtM: number | null;

  @Column({ name: 'fullness_percent', type: 'real', nullable: true })
  fullnessPercent: number | null;

  @Column({ name: 'fullness_justification', type: 'text', nullable: true })
  fullnessJustification: string | null;

  @Column({ name: 'last_nav_status', type: 'varchar', nullable: true })
  lastNavStatus: string | null;

  @Column({ name: 'last_destination_raw', type: 'varchar', nullable: true })
  lastDestinationRaw: string | null;

  @Column({ name: 'last_eta_raw', type: 'varchar', nullable: true })
  lastEtaRaw: string | null;

  @Column({ name: 'last_lat', type: 'real', nullable: true })
  lastLat: number | null;

  @Column({ name: 'last_lon', type: 'real', nullable: true })
  lastLon: number | null;

  @Column({ name: 'last_speed_kn', type: 'real', nullable: true })
  lastSpeedKn: number | null;

  @Column({ name: 'last_course_deg', type: 'real', nullable: true })
  lastCourseDeg: number | null;

  @Column({ name: 'last_position_at', type: 'datetime', nullable: true })
  lastPositionAt: Date | null;

  /** When ShipStaticData was last received for this vessel - distinct from lastPositionAt, since capacity/fullness only refresh from static messages. */
  @Column({ name: 'last_static_data_at', type: 'datetime', nullable: true })
  lastStaticDataAt: Date | null;

  @CreateDateColumn({ name: 'first_seen_at' })
  firstSeenAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
