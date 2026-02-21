import { Module } from '@nestjs/common';
import { CurrencyRatesProvider } from './currency-rates.provider';
import { CurrencyService } from './currency.service';

@Module({
  providers: [CurrencyRatesProvider, CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}
