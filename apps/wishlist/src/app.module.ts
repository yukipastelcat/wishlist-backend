import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GiftsModule } from './gifts/gifts.module';
import { TagsModule } from './tags/tags.module';
import { CurrencyModule } from './currency/currency.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gift } from './gifts/gift.entity';
import { GiftClaim } from './gifts/gift-claim.entity';
import { Tag } from './gifts/tag.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [Gift, GiftClaim, Tag],
      synchronize: true,
    }),
    GiftsModule,
    TagsModule,
    CurrencyModule,
  ],
})
export class AppModule {}
