import { Injectable, InternalServerErrorException } from '@nestjs/common';

export type RatesSnapshot = {
  base: string;
  rates: Map<string, number>;
};

@Injectable()
export class CurrencyRatesProvider {
  async fetchRates(baseCurrency: string): Promise<RatesSnapshot> {
    const urlTemplate =
      process.env.CURRENCY_RATES_URL ?? 'https://open.er-api.com/v6/latest/{base}';
    const url = urlTemplate.includes('{base}')
      ? urlTemplate.replace('{base}', baseCurrency)
      : `${urlTemplate.replace(/\/$/, '')}/${baseCurrency}`;

    const apiKey = process.env.CURRENCY_API_KEY;
    const response = await fetch(url, {
      headers: apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
            apikey: apiKey,
          }
        : undefined,
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch currency rates: ${response.status}`,
      );
    }

    const payload = (await response.json()) as {
      base?: string;
      base_code?: string;
      rates?: Record<string, number>;
    };

    if (!payload.rates || typeof payload.rates !== 'object') {
      throw new InternalServerErrorException('Rates payload is invalid');
    }

    const base = (
      payload.base ??
      payload.base_code ??
      baseCurrency
    ).toUpperCase();
    const rates = new Map<string, number>();

    for (const [currency, rate] of Object.entries(payload.rates)) {
      if (!/^[A-Z]{3}$/.test(currency.toUpperCase())) continue;
      if (!Number.isFinite(rate) || rate <= 0) continue;
      rates.set(currency.toUpperCase(), rate);
    }

    rates.set(base, 1);

    return { base, rates };
  }
}
