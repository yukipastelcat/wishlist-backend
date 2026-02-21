import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Gift } from './gift.entity';

@Entity({ name: 'gift_claims' })
export class GiftClaim {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  giftId!: string;

  @ManyToOne(() => Gift, (gift) => gift.claims, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gift_id' })
  gift!: Gift;

  @Column()
  userEmail!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;
}
