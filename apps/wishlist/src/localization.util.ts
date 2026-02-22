import { BadRequestException } from '@nestjs/common';

export type LocalizedTextMap = Record<string, string>;

export function resolveRequestLocale(
  ...candidates: Array<string | undefined>
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const firstPart = candidate.split(',')[0]?.split(';')[0]?.trim();
    if (!firstPart) continue;
    return normalizeLocale(firstPart);
  }

  return undefined;
}

export function parseLocalizedTextMap(
  value: unknown,
  fieldName: string,
): LocalizedTextMap | undefined {
  if (value == null) return undefined;

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(
      `${fieldName} must be an object map of locale to string`,
    );
  }

  const result: LocalizedTextMap = {};
  const entries = Object.entries(value as Record<string, unknown>);

  for (const [rawLocale, rawText] of entries) {
    const locale = normalizeLocale(rawLocale);

    if (!isLocaleKey(locale)) {
      throw new BadRequestException(
        `${fieldName} contains invalid locale key: ${rawLocale}`,
      );
    }

    if (typeof rawText !== 'string') {
      throw new BadRequestException(`${fieldName} values must be strings`);
    }

    const text = rawText.trim();
    if (!text) {
      throw new BadRequestException(
        `${fieldName} values must be non-empty strings`,
      );
    }

    result[locale] = text;
  }

  return result;
}

export function resolveLocalizedText(
  localized: LocalizedTextMap | undefined,
  locale: string | undefined,
  fallbackLocale = 'en',
): string | undefined {
  if (!localized || Object.keys(localized).length === 0) return undefined;

  const byNormalizedKey = normalizeMapKeys(localized);
  const normalizedLocale = locale ? normalizeLocale(locale) : undefined;

  if (normalizedLocale) {
    const exact = byNormalizedKey[normalizedLocale];
    if (exact) return exact;

    const baseLanguage = normalizedLocale.split('-')[0];
    const base = byNormalizedKey[baseLanguage];
    if (base) return base;
  }

  const fallback = byNormalizedKey[normalizeLocale(fallbackLocale)];
  if (fallback) return fallback;

  return Object.values(byNormalizedKey)[0];
}

function normalizeMapKeys(localized: LocalizedTextMap): LocalizedTextMap {
  const normalized: LocalizedTextMap = {};
  for (const [key, value] of Object.entries(localized)) {
    normalized[normalizeLocale(key)] = value;
  }
  return normalized;
}

function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase().replace(/_/g, '-');
}

function isLocaleKey(locale: string): boolean {
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(locale);
}
