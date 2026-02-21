import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Gift } from './gift.entity';

@Entity({ name: 'gift_reservations' })
export class GiftReservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  giftId!: string;

  @ManyToOne(() => Gift, (gift) => gift.reservations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'giftId' })
  gift!: Gift;

  @Column()
  userEmail!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;
}
