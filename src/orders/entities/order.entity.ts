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

export enum PaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
  CREDIT_CARD = 'credit_card',
  E_WALLET = 'e_wallet',
}

export enum OrderStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  REFUNDED = 'refunded',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', unique: true })
  orderId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'container_id' })
  containerId: string;

  @Column({ name: 'shipment_id', type: 'varchar', nullable: true })
  shipmentId: string | null;

  @Column({ name: 'volume_cbm', type: 'real' })
  volumeCbm: number;

  @Column()
  destination: string;

  @Column({ name: 'departure_date' })
  departureDate: string;

  @Column({ name: 'payment_method', type: 'varchar' })
  paymentMethod: PaymentMethod;

  @Column({ name: 'cbm_rate', type: 'integer' })
  cbmRate: number;

  @Column({ name: 'subscription_fee', type: 'integer', default: 19000 })
  subscriptionFee: number;

  @Column({ name: 'payment_fee', type: 'integer', default: 0 })
  paymentFee: number;

  @Column({ name: 'amount_idr', type: 'integer' })
  amountIdr: number;

  @Column({ name: 'status', type: 'varchar', default: OrderStatus.PENDING })
  status: OrderStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
