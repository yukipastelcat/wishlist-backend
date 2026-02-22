import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GiftsModule } from './gifts/gifts.module';
import { TagsModule } from './tags/tags.module';
import { CurrencyModule } from './currency/currency.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gift } from './gifts/gift.entity';
import { GiftReservation } from './gifts/gift-reservation.entity';
import { Tag } from './gifts/tag.entity';
import * as fs from 'fs';

function resolveDbPassword(): string | undefined {
  const passwordFile = (process.env.DB_PASSWORD_FILE ?? '').trim();
  if (passwordFile) {
    try {
      return fs.readFileSync(passwordFile, 'utf-8').trim();
    } catch {
      // Fallback to DB_PASSWORD when file is unavailable.
    }
  }

  return (process.env.DB_PASSWORD ?? '').trim() || undefined;
}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER,
      password: resolveDbPassword(),
      database: process.env.DB_NAME,
      entities: [Gift, GiftReservation, Tag],
      synchronize: true,
    }),
    GiftsModule,
    TagsModule,
    CurrencyModule,
  ],
})
export class AppModule {}
