import { Module } from '@nestjs/common';
import { AuthzModule } from '@app/auth';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gift } from './gift.entity';
import { GiftReservation } from './gift-reservation.entity';
import { Tag } from './tag.entity';
import { CurrencyModule } from '../currency/currency.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    AuthzModule,
    CurrencyModule,
    NotificationsModule,
    TypeOrmModule.forFeature([Gift, GiftReservation, Tag]),
  ],
  controllers: [GiftsController],
  providers: [GiftsService],
})
export class GiftsModule {}
