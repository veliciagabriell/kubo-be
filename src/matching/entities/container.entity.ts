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

/**
 * A bookable Consolidated LCL slot on a real, AIS-tracked voyage. Created as
 * soon as VoyageDetectionService confirms a real large cargo vessel either:
 *  - is detected near Tanjung Emas/Tanjung Perak (`voyage.created`,
 *    AWAITING_DEPARTURE) - `departureDate` estimated as "ready today"
 *    (already at the port), or
 *  - is detected ANYWHERE ELSE in the wider AIS region already broadcasting
 *    one of those ports as its AIS destination (`voyage.created`, INBOUND) -
 *    `departureDate` estimated as the vessel's real ETA to that port
 *    (distance/speed from its current AIS position), which MatchingService
 *    also recomputes live at view-build time via `originPortId` for as long
 *    as `departureConfirmed` stays false.
 * Never seeded either way. Once the vessel is actually observed leaving the
 * origin port zone (`voyage.updated` -> DEPARTED), `departureDate` is
 * overwritten with the real AIS-confirmed date and `departureConfirmed`
 * flips to true. `totalCapacityCbm` uses the real ISO standard container
 * capacity; `currentUsedCbm`/`umkmCount` only grow via real bookings in
 * OrdersService; `costPerCbm` is a labelled distance-based freight-forwarder
 * estimate (see `freightEstimateJustification`).
 */
@Entity('containers')
export class Container {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'voyage_id', unique: true })
  voyageId: string;

  @Column({ name: 'vessel_mmsi' })
  vesselMmsi: string;

  @Column({ name: 'destination_country', default: 'Japan' })
  destinationCountry: string;

  @Column({ name: 'destination_city' })
  destinationCity: string;

  @Column({ name: 'destination_confidence', type: 'varchar', nullable: true })
  destinationConfidence: string | null;

  @Column({ name: 'origin_port' })
  originPort: string;

  /** PORT_ZONES id for originPort (e.g. 'tanjung_emas') - lets the view layer recompute a live ETA to this port from the vessel's current AIS position while departureConfirmed is false. Nullable only for rows created before this column existed. */
  @Column({ name: 'origin_port_id', type: 'varchar', nullable: true })
  originPortId: string | null;

  @Column({ name: 'container_type', type: 'varchar' })
  containerType: ContainerType;

  @Column({ name: 'total_capacity_cbm', type: 'real' })
  totalCapacityCbm: number;

  @Column({ name: 'current_used_cbm', type: 'real', default: 0 })
  currentUsedCbm: number;

  @Column({ name: 'departure_date' })
  departureDate: string;

  /** True once the vessel was actually observed leaving the origin port zone via AIS; false = estimated departureDate. */
  @Column({ name: 'departure_confirmed', default: false })
  departureConfirmed: boolean;

  @Column({ name: 'departure_estimate_justification', type: 'text', nullable: true })
  departureEstimateJustification: string | null;

  @Column({ name: 'cargo_cutoff_date', type: 'varchar', nullable: true })
  cargoCutoffDate: string | null;

  @Column({ name: 'document_cutoff_date', type: 'varchar', nullable: true })
  documentCutoffDate: string | null;

  /** Real elapsed days between departure and arrival - null until the vessel has actually arrived. */
  @Column({ name: 'transit_days', type: 'integer', nullable: true })
  transitDays: number | null;

  @Column({ name: 'cost_per_cbm', type: 'integer' })
  costPerCbm: number;

  @Column({ name: 'freight_estimate_justification', type: 'text', nullable: true })
  freightEstimateJustification: string | null;

  @Column({ default: 'open' })
  status: string;

  @Column({ name: 'umkm_count', default: 0 })
  umkmCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
