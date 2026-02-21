import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GiftReservation } from './gift-reservation.entity';
import { Tag } from './tag.entity';

@Entity({ name: 'gifts' })
export class Gift {
  @PrimaryGeneratedColumn('uuid')
  id!: string; // uuid

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'jsonb', default: {} })
  titleLocalized?: Record<string, string>;

  @Column({ type: 'jsonb', nullable: true })
  descriptionLocalized?: Record<string, string>;

  @Column({ nullable: true })
  imageUrl?: string;

  @Column({ nullable: true })
  link?: string;

  @Column({ type: 'double precision', nullable: true })
  priceAmount?: number | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  priceCurrency?: string;

  @ManyToMany(() => Tag, { eager: true })
  @JoinTable({
    name: 'gift_tags',
    joinColumn: { name: 'gift_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags?: Tag[];

  @Column({ default: true })
  claimable!: boolean;

  // Stores the id of the active GiftReservation, if any
  @Column({ type: 'uuid', nullable: true })
  reservationId?: string | null;

  @OneToMany(() => GiftReservation, (reservation: GiftReservation) => reservation.gift)
  reservations!: GiftReservation[];
}
