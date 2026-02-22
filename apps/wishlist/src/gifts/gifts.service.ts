import {
  BadRequestException,
  ForbiddenException,
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
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { CurrencyService } from '../currency/currency.service';
import { GiftReservation } from './gift-reservation.entity';
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

  constructor(
    @InjectRepository(Gift) private giftRepo: Repository<Gift>,
    @InjectRepository(GiftReservation)
    private reservationRepo: Repository<GiftReservation>,
    @InjectRepository(Tag) private tagRepo: Repository<Tag>,
    private readonly currencyService: CurrencyService,
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
      descriptionLocalized: gift.descriptionLocalized,
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

    const parsedDescriptionLocalized = parseLocalizedTextMap(
      descriptionLocalized,
      'descriptionLocalized',
    );
    const gift = this.giftRepo.create();
    gift.titleLocalized = parsedTitleLocalized;
    gift.descriptionLocalized = parsedDescriptionLocalized;
    gift.imageUrl = imageUrl;
    gift.link = link;
    this.applyPriceWriteInput(gift, price);
    if (typeof claimable === 'boolean') {
      gift.claimable = claimable;
    }

    if (tagIds) {
      gift.tags = await this.tagRepo.findBy({ id: In(tagIds) });
    }

    const saved = await this.giftRepo.save(gift);
    this.logger.log(
      `Gift created (giftId=${saved.id}, tagCount=${saved.tags?.length ?? 0})`,
    );
    const hydrated = await this.findGiftOrThrow(saved.id);
    return this.toGiftResponse(hydrated, context);
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
      gift.descriptionLocalized = parseLocalizedTextMap(
        descriptionLocalized,
        'descriptionLocalized',
      );
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
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
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

  toGiftResponse(gift: Gift, context: GiftContext): GiftResponseDto {
    const price = this.toPriceDto(gift, context);

    return {
      id: gift.id,
      createdAt: gift.createdAt,
      title:
        resolveLocalizedText(gift.titleLocalized, context.locale) ?? 'Untitled',
      description: resolveLocalizedText(
        gift.descriptionLocalized,
        context.locale,
      ),
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
    const gift = await this.giftRepo.findOne({
      where: { id },
      relations: ['reservations', 'tags'],
    });

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

    const giftsWithRelations = await this.giftRepo.find({
      where: { id: In(ids) },
      relations: ['reservations', 'tags'],
    });

    const giftById = new Map(giftsWithRelations.map((gift) => [gift.id, gift]));
    return ids
      .map((id) => giftById.get(id))
      .filter((gift): gift is Gift => Boolean(gift));
  }
}
