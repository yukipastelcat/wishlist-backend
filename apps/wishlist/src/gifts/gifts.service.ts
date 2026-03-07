import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  applyCursorPagination,
  CursorPaginatedResponse,
  encodeCursor,
  normalizePaginationLimit,
} from '@app/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository, SelectQueryBuilder } from 'typeorm';
import { CurrencyService } from '../currency/currency.service';
import { GiftReservation } from './gift-reservation.entity';
import { Cron } from '@nestjs/schedule';
import {
  GiftEditResponseDto,
  GiftResponseDto,
  TagResponseDto,
} from './gift-response.dto';
import { Gift } from './gift.entity';
import { Tag } from './tag.entity';
import { GiftListQueryDto } from './gift-list-query.dto';
import {
  parseLocalizedTextMap,
  resolveLocalizedText,
} from '../localization.util';
import {
  normalizeStoredLocalizedEditorDocumentMap,
  parseLocalizedEditorDocumentMap,
  resolveLocalizedEditorDocument,
} from './editor-content.util';
import { EMAIL_SERVICE } from '../notifications/email.service';
import type { EmailService } from '../notifications/email.service';

type GiftWriteInput = {
  title?: unknown;
  description?: unknown;
  imageUrl?: string;
  link?: string;
  price?: {
    amount?: number;
    currency?: string;
  } | null;
  claimable?: boolean;
  tagIds?: string[];
  titleLocalized?: unknown;
  descriptionLocalized?: unknown;
};

type GiftContext = {
  targetCurrency?: string;
  userCurrency?: string;
  locale?: string;
  requesterEmail?: string;
  isAdmin?: boolean;
};

@Injectable()
export class GiftsService {
  private readonly logger = new Logger(GiftsService.name);
  private static readonly CREATE_RETRY_ATTEMPTS = 2;
  private static readonly CREATE_RETRY_DELAY_MS = 200;
  private static readonly READ_RETRY_ATTEMPTS = 3;
  private static readonly READ_RETRY_DELAY_MS = 300;
  private static readonly RESERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  private static readonly RESERVATION_WARNING_WINDOW_MS =
    7 * 24 * 60 * 60 * 1000;
  private static readonly RESERVATION_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
  private readonly frontendOrigin = (process.env.FE_ORIGIN ?? '').trim();

  constructor(
    @InjectRepository(Gift) private giftRepo: Repository<Gift>,
    @InjectRepository(GiftReservation)
    private reservationRepo: Repository<GiftReservation>,
    @InjectRepository(Tag) private tagRepo: Repository<Tag>,
    private readonly currencyService: CurrencyService,
    @Inject(EMAIL_SERVICE)
    private readonly emailService: EmailService,
  ) {}

  async findAll(
    query: GiftListQueryDto,
    context: GiftContext,
  ): Promise<CursorPaginatedResponse<GiftResponseDto>> {
    const filters = this.parseListFilters(query);
    this.logger.debug(
      `Listing gifts (limit=${query.limit ?? 'default'}, hasCursor=${Boolean(
        query.cursor,
      )}, hasSearch=${Boolean(filters.search)}, hasPriceRange=${Boolean(
        filters.minPrice != null || filters.maxPrice != null,
      )})`,
    );
    const qb = this.giftRepo.createQueryBuilder('gift');
    this.applyListFilters(qb, filters);

    if (filters.minPrice != null || filters.maxPrice != null) {
      return this.findAllWithLocalizedPriceFilter(query, context, qb, filters);
    }

    const paged = await applyCursorPagination<Gift>(qb, {
      cursor: query.cursor,
      limit: query.limit,
    });

    if (paged.data.length === 0) {
      this.logger.debug('Gift list completed with no results');
      return {
        data: [],
        meta: paged.meta,
      };
    }

    const orderedGifts = await this.hydrateGiftsInOrder(
      paged.data.map((gift) => gift.id),
    );

    this.logger.debug(
      `Gift list completed with ${orderedGifts.length} results`,
    );
    return {
      data: orderedGifts.map((gift) => this.toGiftResponse(gift, context)),
      meta: paged.meta,
    };
  }

  async findOne(id: string, context: GiftContext): Promise<GiftResponseDto> {
    const gift = await this.findGiftOrThrow(id);
    return this.toGiftResponse(gift, context);
  }

  async findOneForEdit(id: string): Promise<GiftEditResponseDto> {
    const gift = await this.findGiftOrThrow(id);

    return {
      id: gift.id,
      createdAt: gift.createdAt,
      titleLocalized: gift.titleLocalized ?? {},
      descriptionLocalized: normalizeStoredLocalizedEditorDocumentMap(
        gift.descriptionLocalized,
      ),
      imageUrl: gift.imageUrl,
      link: gift.link,
      claimable: gift.claimable,
      tagIds: gift.tags?.map((tag) => tag.id) ?? [],
      price:
        gift.priceAmount == null || !gift.priceCurrency
          ? null
          : {
              amount: gift.priceAmount,
              currency: this.normalizeCurrency(gift.priceCurrency),
            },
    };
  }

  async create(
    data: GiftWriteInput,
    context: GiftContext,
  ): Promise<GiftResponseDto> {
    const {
      title: _unusedTitle,
      description: _unusedDescription,
      tagIds,
      titleLocalized,
      descriptionLocalized,
      imageUrl,
      link,
      price,
      claimable,
    } = data;
    const parsedTitleLocalized = parseLocalizedTextMap(
      titleLocalized,
      'titleLocalized',
    );
    this.ensureNonEmptyLocalizedField(parsedTitleLocalized, 'titleLocalized');

    const parsedEditorDescriptionLocalized = parseLocalizedEditorDocumentMap(
      descriptionLocalized,
      'descriptionLocalized',
    );
    const gift = this.giftRepo.create();
    gift.titleLocalized = parsedTitleLocalized;
    gift.descriptionLocalized = parsedEditorDescriptionLocalized;
    gift.imageUrl = imageUrl;
    gift.link = link;
    this.applyPriceWriteInput(gift, price);
    if (typeof claimable === 'boolean') {
      gift.claimable = claimable;
    }

    if (tagIds) {
      gift.tags = await this.tagRepo.findBy({ id: In(tagIds) });
    }

    const saved = await this.saveGiftWithRetry(gift);
    this.logger.log(
      `Gift created (giftId=${saved.id}, tagCount=${saved.tags?.length ?? 0})`,
    );
    saved.tags = gift.tags ?? saved.tags ?? [];
    saved.reservations = [];
    saved.reservationId = null;
    return this.toGiftResponse(saved, context);
  }

  private async saveGiftWithRetry(gift: Gift): Promise<Gift> {
    for (
      let attempt = 1;
      attempt <= GiftsService.CREATE_RETRY_ATTEMPTS;
      attempt++
    ) {
      try {
        return await this.giftRepo.save(gift);
      } catch (error) {
        const isLastAttempt = attempt === GiftsService.CREATE_RETRY_ATTEMPTS;
        if (!this.isRetryableDbTimeout(error) || isLastAttempt) {
          throw error;
        }

        this.logger.warn(
          `Retrying gift create after transient DB timeout (attempt ${attempt}/${GiftsService.CREATE_RETRY_ATTEMPTS})`,
        );
        await this.delay(GiftsService.CREATE_RETRY_DELAY_MS);
      }
    }

    throw new BadRequestException('Failed to create gift');
  }

  private async withReadRetry<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    for (
      let attempt = 1;
      attempt <= GiftsService.READ_RETRY_ATTEMPTS;
      attempt++
    ) {
      try {
        return await operation();
      } catch (error) {
        const isLastAttempt = attempt === GiftsService.READ_RETRY_ATTEMPTS;
        if (!this.isRetryableDbTimeout(error) || isLastAttempt) {
          throw error;
        }

        this.logger.warn(
          `Retrying ${operationName} after transient DB timeout (attempt ${attempt}/${GiftsService.READ_RETRY_ATTEMPTS})`,
        );
        await this.delay(GiftsService.READ_RETRY_DELAY_MS);
      }
    }

    throw new BadRequestException(`Failed to ${operationName}`);
  }

  private isRetryableDbTimeout(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = (error as QueryFailedError & { driverError?: unknown })
      .driverError as { code?: string; syscall?: string } | undefined;

    return driverError?.code === 'ETIMEDOUT' && driverError?.syscall === 'read';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async update(
    id: string,
    data: GiftWriteInput,
    context: GiftContext,
  ): Promise<GiftResponseDto> {
    this.logger.debug(`Updating gift (giftId=${id})`);
    const gift = await this.giftRepo.findOne({ where: { id } });
    if (!gift) throw new NotFoundException('Gift not found');

    const {
      title: _unusedTitle,
      description: _unusedDescription,
      tagIds,
      titleLocalized,
      descriptionLocalized,
      imageUrl,
      link,
      price,
      claimable,
    } = data;

    if (Object.prototype.hasOwnProperty.call(data, 'imageUrl')) {
      gift.imageUrl = imageUrl;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'link')) {
      gift.link = link;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'price')) {
      this.applyPriceWriteInput(gift, price);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'claimable')) {
      gift.claimable = Boolean(claimable);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'titleLocalized')) {
      const parsedTitleLocalized = parseLocalizedTextMap(
        titleLocalized,
        'titleLocalized',
      );
      this.ensureNonEmptyLocalizedField(parsedTitleLocalized, 'titleLocalized');
      gift.titleLocalized = parsedTitleLocalized;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'descriptionLocalized')) {
      const parsedEditorDescriptionMap = parseLocalizedEditorDocumentMap(
        descriptionLocalized,
        'descriptionLocalized',
      );
      gift.descriptionLocalized = parsedEditorDescriptionMap;
    }

    this.ensureNonEmptyLocalizedField(gift.titleLocalized, 'titleLocalized');

    if (tagIds) {
      gift.tags = await this.tagRepo.findBy({ id: In(tagIds) });
    }

    await this.giftRepo.save(gift);
    this.logger.log(`Gift updated (giftId=${id})`);
    const hydrated = await this.findGiftOrThrow(id);
    return this.toGiftResponse(hydrated, context);
  }

  async remove(id: string, context: GiftContext): Promise<GiftResponseDto> {
    this.logger.debug(`Removing gift (giftId=${id})`);
    const gift = await this.findGiftOrThrow(id);
    await this.giftRepo.remove(gift);
    this.logger.log(`Gift removed (giftId=${id})`);
    return this.toGiftResponse(gift, context);
  }

  async reserve(
    giftId: string,
    userEmail: string,
    context: GiftContext,
  ): Promise<GiftResponseDto> {
    this.logger.debug(`Creating gift reservation (giftId=${giftId})`);
    const gift = await this.giftRepo.findOne({
      where: { id: giftId },
      relations: ['reservations', 'tags'],
    });
    if (!gift) throw new NotFoundException('Gift not found');
    if (!gift.claimable) throw new ForbiddenException('Gift not claimable');
    if (gift.reservationId)
      throw new ForbiddenException('Gift already reserved');

    const insertResult = await this.reservationRepo.insert({
      giftId: gift.id,
      userEmail,
      expiresAt: new Date(Date.now() + GiftsService.RESERVATION_TTL_MS),
    });
    const insertedId = insertResult.identifiers[0]?.id as string | undefined;
    if (!insertedId) {
      throw new BadRequestException('Failed to create reservation');
    }

    const savedReservation = await this.reservationRepo.findOneBy({
      id: insertedId,
    });
    if (!savedReservation) {
      throw new BadRequestException('Failed to load created reservation');
    }
    await this.giftRepo.update(
      { id: gift.id },
      { reservationId: savedReservation.id },
    );
    this.logger.log(
      `Gift reserved (giftId=${giftId}, reservationId=${savedReservation.id})`,
    );

    const hydrated = await this.findGiftOrThrow(gift.id);
    return this.toGiftResponse(hydrated, context);
  }

  async unreserve(
    giftId: string,
    userEmail: string,
    context: GiftContext,
  ): Promise<GiftResponseDto> {
    this.logger.debug(`Removing gift reservation (giftId=${giftId})`);
    const gift = await this.giftRepo.findOne({
      where: { id: giftId },
      relations: ['reservations', 'tags'],
    });
    if (!gift) throw new NotFoundException('Gift not found');
    if (!gift.reservationId) throw new ForbiddenException('Gift not reserved');

    const reservation = await this.reservationRepo.findOne({
      where: { id: gift.reservationId, userEmail },
    });
    if (!reservation)
      throw new ForbiddenException('Cannot unreserve: not owner');

    await this.reservationRepo.remove(reservation);
    await this.giftRepo.update({ id: gift.id }, { reservationId: null });
    this.logger.log(`Gift unreserved (giftId=${giftId})`);

    const hydrated = await this.findGiftOrThrow(gift.id);
    return this.toGiftResponse(hydrated, context);
  }

  async prolongReservation(
    giftId: string,
    userEmail: string,
    context: GiftContext,
  ): Promise<GiftResponseDto> {
    this.logger.debug(`Prolonging gift reservation (giftId=${giftId})`);
    const gift = await this.giftRepo.findOne({
      where: { id: giftId },
      relations: ['reservations', 'tags'],
    });
    if (!gift) throw new NotFoundException('Gift not found');
    if (!gift.reservationId) throw new ForbiddenException('Gift not reserved');

    const reservation = await this.reservationRepo.findOne({
      where: { id: gift.reservationId, userEmail },
    });
    if (!reservation) {
      throw new ForbiddenException('Cannot prolong reservation: not owner');
    }

    const now = Date.now();
    const extensionBase = Math.max(now, reservation.expiresAt.getTime());
    reservation.expiresAt = new Date(
      extensionBase + GiftsService.RESERVATION_TTL_MS,
    );
    await this.reservationRepo.save(reservation);
    this.logger.log(
      `Gift reservation prolonged (giftId=${giftId}, reservationId=${reservation.id})`,
    );

    const hydrated = await this.findGiftOrThrow(gift.id);
    return this.toGiftResponse(hydrated, context);
  }

  @Cron('0 * * * *', { timeZone: 'UTC' })
  async maintainReservations(): Promise<void> {
    const now = new Date();
    await this.removeExpiredReservations(now);
    await this.sendReservationExpiryWarnings(now);
  }

  toGiftResponse(gift: Gift, context: GiftContext): GiftResponseDto {
    const price = this.toPriceDto(gift, context);
    const description = resolveLocalizedEditorDocument(
      gift.descriptionLocalized,
      context.locale,
    );

    return {
      id: gift.id,
      createdAt: gift.createdAt,
      title:
        resolveLocalizedText(gift.titleLocalized, context.locale) ?? 'Untitled',
      description,
      imageUrl: gift.imageUrl,
      link: gift.link,
      claimable: gift.claimable,
      tags: gift.tags?.map((tag) => this.toLocalizedTag(tag, context.locale)),
      price,
      ...this.toReservationFlags(gift, context),
    };
  }

  private toPriceDto(
    gift: Gift,
    context: GiftContext,
  ): GiftResponseDto['price'] {
    if (gift.priceAmount == null || !gift.priceCurrency) {
      return null;
    }

    const sourceCurrency = this.normalizeCurrency(gift.priceCurrency);
    const targetCurrency = this.resolveTargetCurrency(context);

    const localizedAmount = this.currencyService.convert(
      gift.priceAmount,
      sourceCurrency,
      targetCurrency,
    );

    return { amount: localizedAmount, currency: targetCurrency };
  }

  private resolveTargetCurrency(context: GiftContext): string {
    const headerCurrency = context.targetCurrency?.trim();
    const localeCurrency = this.resolveLocaleCurrency(context.locale);
    const userCurrency = context.userCurrency?.trim();
    const fallback = this.currencyService.getDefaultCurrency();

    return this.normalizeCurrency(
      headerCurrency ?? localeCurrency ?? userCurrency ?? fallback,
    );
  }

  private resolveLocaleCurrency(locale?: string): string | undefined {
    if (!locale) return undefined;

    const normalizedLocale = locale.trim().toLowerCase().replace(/_/g, '-');
    const language = normalizedLocale.split('-')[0];
    if (!language) return undefined;

    const localeCurrencyMap: Record<string, string> = {
      en: 'USD',
      ru: 'RUB',
    };

    return localeCurrencyMap[language];
  }

  private normalizeCurrency(currency: string): string {
    const normalized = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new BadRequestException(`Unsupported currency: ${currency}`);
    }
    return normalized;
  }

  private toLocalizedTag(tag: Tag, locale?: string): TagResponseDto {
    const localizedTitle = resolveLocalizedText(tag.titleLocalized, locale);
    return {
      id: tag.id,
      createdAt: tag.createdAt,
      title: localizedTitle ?? 'Untitled',
      color: tag.color,
    };
  }

  private toReservationFlags(
    gift: Gift,
    context: GiftContext,
  ):
    | Pick<GiftResponseDto, 'isReserved' | 'isReservedByMe'>
    | Record<string, never> {
    if (!context.requesterEmail || context.isAdmin) {
      return {};
    }

    const isReserved = Boolean(gift.reservationId);
    const requesterEmail = context.requesterEmail.trim().toLowerCase();
    const isReservedByMe =
      gift.reservations?.some(
        (reservation) =>
          reservation.id === gift.reservationId &&
          reservation.userEmail.trim().toLowerCase() === requesterEmail,
      ) ?? false;

    return {
      isReserved,
      isReservedByMe,
    };
  }

  private applyPriceWriteInput(
    gift: Gift,
    price: GiftWriteInput['price'],
  ): void {
    if (price == null) {
      gift.priceAmount = null;
      gift.priceCurrency = void 0;
      return;
    }

    const { amount, currency } = price;
    if (amount == null && currency == null) {
      gift.priceAmount = null;
      gift.priceCurrency = void 0;
      return;
    }

    if (amount == null || !Number.isFinite(amount)) {
      throw new BadRequestException('price.amount must be a finite number');
    }

    if (!currency || typeof currency !== 'string') {
      throw new BadRequestException(
        'price.currency is required when price.amount is provided',
      );
    }

    gift.priceAmount = amount;
    gift.priceCurrency = this.normalizeCurrency(currency);
  }

  private ensureNonEmptyLocalizedField(
    value: Record<string, string> | undefined,
    fieldName: string,
  ): asserts value is Record<string, string> {
    if (!value || Object.keys(value).length === 0) {
      throw new BadRequestException(
        `${fieldName} must include at least one locale entry`,
      );
    }
  }

  private async findGiftOrThrow(id: string): Promise<Gift> {
    const [gift] = await this.hydrateGiftsInOrder([id]);

    if (!gift) throw new NotFoundException('Gift not found');
    return gift;
  }

  private parseListFilters(query: GiftListQueryDto): {
    search?: string;
    minPrice?: number;
    maxPrice?: number;
  } {
    const search = query.search?.trim() || undefined;
    const minPrice = this.parseOptionalFiniteNumber(query.minPrice, 'minPrice');
    const maxPrice = this.parseOptionalFiniteNumber(query.maxPrice, 'maxPrice');

    if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
      throw new BadRequestException('minPrice cannot be greater than maxPrice');
    }

    return {
      search,
      minPrice,
      maxPrice,
    };
  }

  private parseOptionalFiniteNumber(
    value: string | number | undefined,
    fieldName: string,
  ): number | undefined {
    if (value == null || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);

    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(`${fieldName} must be a finite number`);
    }

    if (parsed < 0) {
      throw new BadRequestException(
        `${fieldName} must be greater than or equal to 0`,
      );
    }

    return parsed;
  }

  private applyListFilters(
    qb: SelectQueryBuilder<Gift>,
    filters: {
      search?: string;
      minPrice?: number;
      maxPrice?: number;
    },
  ): void {
    if (filters.search) {
      qb.andWhere(
        '("gift"."titleLocalized"::text ILIKE :search OR "gift"."descriptionLocalized"::text ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }
  }

  private async findAllWithLocalizedPriceFilter(
    query: GiftListQueryDto,
    context: GiftContext,
    baseQb: SelectQueryBuilder<Gift>,
    filters: { minPrice?: number; maxPrice?: number },
  ): Promise<CursorPaginatedResponse<GiftResponseDto>> {
    const pageSize = normalizePaginationLimit(query.limit);
    const scanLimit = Math.max(pageSize * 3, 30);
    const matched: Gift[] = [];
    let scanCursor = query.cursor;
    let hasMoreRawPages = true;

    while (hasMoreRawPages && matched.length < pageSize + 1) {
      const qb = baseQb.clone();
      const paged = await applyCursorPagination<Gift>(qb, {
        cursor: scanCursor,
        limit: scanLimit,
      });

      if (paged.data.length === 0) {
        hasMoreRawPages = false;
        break;
      }

      const hydratedChunk = await this.hydrateGiftsInOrder(
        paged.data.map((gift) => gift.id),
      );
      for (const gift of hydratedChunk) {
        if (this.matchesLocalizedPriceRange(gift, context, filters)) {
          matched.push(gift);
          if (matched.length >= pageSize + 1) break;
        }
      }

      hasMoreRawPages = paged.meta.hasNextPage;
      scanCursor = paged.meta.nextCursor ?? undefined;
    }

    const hasNextPage = matched.length > pageSize;
    const pageData = hasNextPage ? matched.slice(0, pageSize) : matched;
    const lastItem = pageData[pageData.length - 1];
    const nextCursor =
      hasNextPage && lastItem
        ? encodeCursor({
            createdAt: lastItem.createdAt.toISOString(),
            id: lastItem.id,
          })
        : null;

    return {
      data: pageData.map((gift) => this.toGiftResponse(gift, context)),
      meta: {
        hasNextPage,
        nextCursor,
      },
    };
  }

  private matchesLocalizedPriceRange(
    gift: Gift,
    context: GiftContext,
    filters: { minPrice?: number; maxPrice?: number },
  ): boolean {
    const localizedPrice = this.toPriceDto(gift, context);
    if (!localizedPrice) {
      return false;
    }

    if (filters.minPrice != null && localizedPrice.amount < filters.minPrice) {
      return false;
    }

    if (filters.maxPrice != null && localizedPrice.amount > filters.maxPrice) {
      return false;
    }

    return true;
  }

  private async hydrateGiftsInOrder(ids: string[]): Promise<Gift[]> {
    if (ids.length === 0) return [];

    const giftsWithRelations = await this.withReadRetry(
      'hydrate gifts',
      async () =>
        this.giftRepo
          .createQueryBuilder('gift')
          .leftJoinAndSelect('gift.tags', 'tag')
          // We only need the active reservation for list/view response flags.
          .leftJoinAndMapMany(
            'gift.reservations',
            GiftReservation,
            'reservation',
            'reservation.id = gift.reservationId',
          )
          .where('gift.id IN (:...ids)', { ids })
          .getMany(),
    );

    const giftById = new Map(giftsWithRelations.map((gift) => [gift.id, gift]));
    return ids
      .map((id) => giftById.get(id))
      .filter((gift): gift is Gift => Boolean(gift));
  }

  private async removeExpiredReservations(now: Date): Promise<void> {
    const expired = await this.giftRepo
      .createQueryBuilder('gift')
      .innerJoinAndSelect(
        'gift.reservations',
        'reservation',
        'reservation.id = gift.reservationId',
      )
      .where('reservation.expiresAt <= :now', { now: now.toISOString() })
      .getMany();

    if (expired.length === 0) return;

    const giftIds = expired.map((gift) => gift.id);
    const reservationIds = expired
      .map((gift) => gift.reservations[0]?.id)
      .filter((value): value is string => Boolean(value));

    if (giftIds.length > 0) {
      await this.giftRepo
        .createQueryBuilder()
        .update(Gift)
        .set({ reservationId: null })
        .where('id IN (:...giftIds)', { giftIds })
        .execute();
    }

    if (reservationIds.length > 0) {
      await this.reservationRepo
        .createQueryBuilder()
        .delete()
        .where('id IN (:...reservationIds)', { reservationIds })
        .execute();
    }

    this.logger.log(
      `Removed ${reservationIds.length} expired reservations (giftCount=${giftIds.length})`,
    );
  }

  private async sendReservationExpiryWarnings(now: Date): Promise<void> {
    if (!this.frontendOrigin) {
      this.logger.warn(
        'Skipping reservation expiry warnings: FE_ORIGIN is not configured',
      );
      return;
    }

    const warningThreshold = new Date(
      now.getTime() + GiftsService.RESERVATION_WARNING_WINDOW_MS,
    );
    const warningThresholdLowerBound = new Date(
      warningThreshold.getTime() -
        GiftsService.RESERVATION_MAINTENANCE_INTERVAL_MS,
    );
    const expiringSoon = await this.giftRepo
      .createQueryBuilder('gift')
      .innerJoinAndSelect(
        'gift.reservations',
        'reservation',
        'reservation.id = gift.reservationId',
      )
      .where('reservation.expiresAt > :now', { now: now.toISOString() })
      .andWhere('reservation.expiresAt <= :warningThreshold', {
        warningThreshold: warningThreshold.toISOString(),
      })
      .andWhere('reservation.expiresAt > :warningThresholdLowerBound', {
        warningThresholdLowerBound: warningThresholdLowerBound.toISOString(),
      })
      .getMany();

    for (const gift of expiringSoon) {
      const reservation = gift.reservations[0];
      if (!reservation) continue;

      try {
        const warningMessage = this.buildReservationWarningMessage(
          gift.id,
          gift.titleLocalized,
        );
        await this.emailService.sendEmail({
          to: reservation.userEmail,
          subject: 'Your gift reservation expires soon',
          body: warningMessage.text,
          html: warningMessage.html,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to send reservation warning (reservationId=${reservation.id}): ${message}`,
        );
      }
    }
  }

  private buildReservationWarningMessage(
    giftId: string,
    titleLocalized?: Record<string, string>,
  ): { text: string; html: string } {
    const baseUrl = this.frontendOrigin.replace(/\/$/, '');
    const encodedGiftId = encodeURIComponent(giftId);
    const giftTitle = resolveLocalizedText(titleLocalized, 'en') ?? 'Gift';
    const prolongUrl = `${baseUrl}/reservation-actions/prolong?giftId=${encodedGiftId}`;
    const cancelUrl = `${baseUrl}/reservation-actions/cancel?giftId=${encodedGiftId}`;

    const text = [
      `Your reservation for "${giftTitle}" will be removed in 7 days.`,
      '',
      `Prolong reservation: ${prolongUrl}`,
      `Cancel reservation: ${cancelUrl}`,
    ].join('\n');

    const html = [
      `<p>Your reservation for "${giftTitle}" will be removed in 7 days.</p>`,
      '<p>',
      `<a href="${prolongUrl}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:6px;margin-right:8px;">Prolong reservation</a>`,
      `<a href="${cancelUrl}" style="display:inline-block;padding:10px 16px;background:#dc2626;color:#ffffff;text-decoration:none;border-radius:6px;">Cancel reservation</a>`,
      '</p>',
    ].join('');

    return { text, html };
  }
}
