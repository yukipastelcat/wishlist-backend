import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'tags' })
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'jsonb', default: {} })
  titleLocalized?: Record<string, string>;

  @Column()
  color!: string;
}
