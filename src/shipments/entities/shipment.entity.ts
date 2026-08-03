import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum ShipmentStatus {
  DRAFT = 'Draft',
  AWAITING_MATCH = 'Awaiting Match',
  MATCHED = 'Matched',
  DOCUMENTS_INCOMPLETE = 'Documents Incomplete',
  AWAITING_VERIFICATION = 'Awaiting Verification',
  AWAITING_BOOKING = 'Awaiting Booking',
  BOOKED = 'Booked',
  CARGO_READY = 'Cargo Ready',
  CARGO_RECEIVED = 'Cargo Received',
  IN_TRANSIT = 'In Transit',
  CUSTOMS_PROCESSING = 'Customs Processing',
  DELIVERED = 'Delivered',
  CANCELLED = 'Cancelled',
}

export enum ShipmentPaymentStatus {
  UNPAID = 'Unpaid',
  DEPOSIT_REQUIRED = 'Deposit Required',
  DEPOSIT_PAID = 'Deposit Paid',
  FULLY_PAID = 'Fully Paid',
  PAYMENT_FAILED = 'Payment Failed',
  REFUND_PROCESSING = 'Refund Processing',
  REFUNDED = 'Refunded',
}

@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shipment_code', unique: true })
  shipmentCode: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'origin_city' })
  originCity: string;

  @Column({ name: 'origin_port' })
  originPort: string;

  @Column({ name: 'destination_country' })
  destinationCountry: string;

  @Column({ name: 'destination_port' })
  destinationPort: string;

  @Column({ name: 'cargo_ready_date' })
  cargoReadyDate: string;

  @Column({ name: 'flexible_date_end' })
  flexibleDateEnd: string;

  @Column({ type: 'real' })
  cbm: number;

  @Column({ type: 'varchar', default: ShipmentStatus.DRAFT })
  status: ShipmentStatus;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    default: ShipmentPaymentStatus.UNPAID,
  })
  paymentStatus: ShipmentPaymentStatus;

  @Column({ name: 'next_action', default: 'Cari container match' })
  nextAction: string;

  @Column({ name: 'container_id', type: 'varchar', nullable: true })
  containerId: string | null;

  @Column({ name: 'order_amount_idr', type: 'integer', nullable: true })
  orderAmountIdr: number | null;

  @Column({ name: 'exporter_name' })
  exporterName: string;

  @Column({ name: 'exporter_company' })
  exporterCompany: string;

  @Column({ name: 'exporter_address' })
  exporterAddress: string;

  @Column({ name: 'exporter_email' })
  exporterEmail: string;

  @Column({ name: 'consignee_name' })
  consigneeName: string;

  @Column({ name: 'consignee_company' })
  consigneeCompany: string;

  @Column({ name: 'consignee_address' })
  consigneeAddress: string;

  @Column({ name: 'consignee_email' })
  consigneeEmail: string;

  @Column({ name: 'product_description' })
  productDescription: string;

  @Column({ name: 'product_hs_code' })
  productHsCode: string;

  @Column({ name: 'product_category' })
  productCategory: string;

  @Column({ name: 'product_quantity', type: 'integer' })
  productQuantity: number;

  @Column({ name: 'product_quantity_unit' })
  productQuantityUnit: string;

  @Column({ name: 'product_gross_weight', type: 'real' })
  productGrossWeight: number;

  @Column({ name: 'product_net_weight', type: 'real' })
  productNetWeight: number;

  @Column({ name: 'product_weight_unit', default: 'kg' })
  productWeightUnit: string;

  @Column({ name: 'product_packaging' })
  productPackaging: string;

  @Column({ name: 'product_stackable', default: false })
  productStackable: boolean;

  @Column({ name: 'product_fragile', default: false })
  productFragile: boolean;

  @Column({ name: 'invoice_number', type: 'varchar', nullable: true })
  invoiceNumber: string | null;

  @Column({ name: 'invoice_date', type: 'varchar', nullable: true })
  invoiceDate: string | null;

  @Column({ name: 'country_of_origin', default: 'Indonesia' })
  countryOfOrigin: string;

  @Column({ name: 'additional_handling', type: 'varchar', nullable: true })
  additionalHandling: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
