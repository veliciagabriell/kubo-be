import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  password: string;

  @Column({ name: 'business_name' })
  businessName: string;

  @Column({ name: 'business_type' })
  businessType: string;

  @Column({ name: 'owner_address' })
  ownerAddress: string;

  @Column({ name: 'business_address' })
  businessAddress: string;

  @Column({ name: 'umkm_certificate_url', nullable: true })
  umkmCertificateUrl: string;

  @Column({ nullable: true })
  nib: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
