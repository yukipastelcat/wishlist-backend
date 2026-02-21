import { Module } from '@nestjs/common';
import { AuthzModule } from '@app/auth';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gift } from './gift.entity';
import { GiftClaim } from './gift-claim.entity';
import { Tag } from './tag.entity';
import { CurrencyModule } from '../currency/currency.module';

@Module({
  imports: [AuthzModule, CurrencyModule, TypeOrmModule.forFeature([Gift, GiftClaim, Tag])],
  controllers: [GiftsController],
  providers: [GiftsService],
})
export class GiftsModule {}
