import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CurrencyRatesProvider } from './currency-rates.provider';

@Injectable()
export class CurrencyService implements OnModuleInit {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly fallbackBaseCurrency = (
    process.env.CURRENCY_BASE_CURRENCY ?? 'USD'
  ).toUpperCase();
  private rates = new Map<string, number>();
  private baseCurrency = this.fallbackBaseCurrency;
  private initialized = false;

  constructor(private readonly ratesProvider: CurrencyRatesProvider) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.refreshRates();
    } catch (error) {
      this.logger.error('Failed to initialize currency rates on boot', error);
    }
  }

  getDefaultCurrency(): string {
    return (process.env.DEFAULT_CURRENCY ?? this.baseCurrency).toUpperCase();
  }

  async refreshRates(): Promise<void> {
    const snapshot = await this.ratesProvider.fetchRates(this.baseCurrency);
    this.baseCurrency = snapshot.base;
    this.rates = snapshot.rates;
    this.initialized = true;
    this.logger.log(
      `Currency rates refreshed for base ${this.baseCurrency} (${this.rates.size} entries)`,
    );
  }

  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async refreshRatesDaily(): Promise<void> {
    try {
      await this.refreshRates();
    } catch (error) {
      this.logger.error('Failed to refresh currency rates', error);
    }
  }

  convert(amount: number, from: string, to: string): number {
    if (!Number.isFinite(amount)) {
      throw new BadRequestException('Amount must be a finite number');
    }

    const normalizedFrom = this.normalizeCurrency(from);
    const normalizedTo = this.normalizeCurrency(to);

    if (normalizedFrom === normalizedTo) {
      return this.roundForCurrency(amount, normalizedTo);
    }

    if (!this.initialized) {
      throw new ServiceUnavailableException('Currency rates are not initialized');
    }

    const fromRate =
      normalizedFrom === this.baseCurrency ? 1 : this.rates.get(normalizedFrom);
    const toRate = normalizedTo === this.baseCurrency ? 1 : this.rates.get(normalizedTo);

    if (!fromRate) {
      throw new BadRequestException(`Missing exchange rate for ${normalizedFrom}`);
    }

    if (!toRate) {
      throw new BadRequestException(`Missing exchange rate for ${normalizedTo}`);
    }

    const converted = this.convertViaBase(amount, fromRate, toRate);
    return this.roundForCurrency(converted, normalizedTo);
  }

  private normalizeCurrency(currency: string): string {
    const normalized = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new BadRequestException(`Unsupported currency: ${currency}`);
    }
    return normalized;
  }

  private roundForCurrency(amount: number, currency: string): number {
    const fractionDigits = this.getFractionDigits(currency);
    const factor = 10 ** fractionDigits;
    return Math.round((amount + Number.EPSILON) * factor) / factor;
  }

  private getFractionDigits(currency: string): number {
    try {
      const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      });
      return formatter.resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      throw new BadRequestException(`Unsupported currency: ${currency}`);
    }
  }

  private convertViaBase(amount: number, fromRate: number, toRate: number): number {
    const SCALE = 1_000_000_000_000n;

    const toScaledInt = (value: number) => {
      return BigInt(Math.round(value * Number(SCALE)));
    };

    const mulScaled = (left: bigint, right: bigint) => {
      return (left * right + SCALE / 2n) / SCALE;
    };

    const divScaled = (left: bigint, right: bigint) => {
      if (right === 0n) {
        throw new BadRequestException('Exchange rate cannot be zero');
      }
      return (left * SCALE + right / 2n) / right;
    };

    const amountScaled = toScaledInt(amount);
    const fromScaled = toScaledInt(fromRate);
    const toScaled = toScaledInt(toRate);

    const baseAmountScaled = divScaled(amountScaled, fromScaled);
    const convertedScaled = mulScaled(baseAmountScaled, toScaled);

    return Number(convertedScaled) / Number(SCALE);
  }
}
