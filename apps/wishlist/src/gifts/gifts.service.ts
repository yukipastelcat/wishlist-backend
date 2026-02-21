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
  CursorPaginationDto,
} from '@app/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CurrencyService } from '../currency/currency.service';
import { GiftClaim } from './gift-claim.entity';
import { GiftResponseDto, TagResponseDto } from './gift-response.dto';
import { Gift } from './gift.entity';
import { Tag } from './tag.entity';
import {
  parseLocalizedTextMap,
  resolveLocalizedText,
} from '../localization.util';

type GiftWriteInput = {
  title?: unknown;
  description?: unknown;
  imageUrl?: string;
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
};

@Injectable()
export class GiftsService {
  private readonly logger = new Logger(GiftsService.name);

  constructor(
    @InjectRepository(Gift) private giftRepo: Repository<Gift>,
    @InjectRepository(GiftClaim) private claimRepo: Repository<GiftClaim>,
    @InjectRepository(Tag) private tagRepo: Repository<Tag>,
    private readonly currencyService: CurrencyService,
  ) {}

  async findAll(
    pagination: CursorPaginationDto,
    context: GiftContext,
  ): Promise<CursorPaginatedResponse<GiftResponseDto>> {
    this.logger.debug(
      `Listing gifts (limit=${pagination.limit ?? 'default'}, hasCursor=${Boolean(
        pagination.cursor,
      )})`,
    );
    const paged = await applyCursorPagination<Gift>(
      this.giftRepo.createQueryBuilder('gift'),
      {
        cursor: pagination.cursor,
        limit: pagination.limit,
      },
    );

    if (paged.data.length === 0) {
      this.logger.debug('Gift list completed with no results');
      return {
        data: [],
        meta: paged.meta,
      };
    }

    const ids = paged.data.map((gift) => gift.id);
    const giftsWithRelations = await this.giftRepo.find({
      where: { id: In(ids) },
      relations: ['claims', 'tags'],
    });

    const giftById = new Map(giftsWithRelations.map((gift) => [gift.id, gift]));
    const orderedGifts = ids
      .map((id) => giftById.get(id))
      .filter((gift): gift is Gift => Boolean(gift));

    this.logger.debug(`Gift list completed with ${orderedGifts.length} results`);
    return {
      data: orderedGifts.map((gift) => this.toGiftResponse(gift, context)),
      meta: paged.meta,
    };
  }

  async create(data: GiftWriteInput, context: GiftContext): Promise<GiftResponseDto> {
    const {
      title: _unusedTitle,
      description: _unusedDescription,
      tagIds,
      titleLocalized,
      descriptionLocalized,
      imageUrl,
      price,
      claimable,
    } = data;
    const parsedTitleLocalized = parseLocalizedTextMap(titleLocalized, 'titleLocalized');
    this.ensureNonEmptyLocalizedField(parsedTitleLocalized, 'titleLocalized');

    const parsedDescriptionLocalized = parseLocalizedTextMap(
      descriptionLocalized,
      'descriptionLocalized',
    );
    const gift = this.giftRepo.create();
    gift.titleLocalized = parsedTitleLocalized;
    gift.descriptionLocalized = parsedDescriptionLocalized;
    gift.imageUrl = imageUrl;
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
      price,
      claimable,
    } = data;

    if (Object.prototype.hasOwnProperty.call(data, 'imageUrl')) {
      gift.imageUrl = imageUrl;
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

  async claim(giftId: string, userEmail: string) {
    this.logger.debug(`Creating gift claim (giftId=${giftId})`);
    const gift = await this.giftRepo.findOne({
      where: { id: giftId },
      relations: ['claims'],
    });
    if (!gift) throw new NotFoundException('Gift not found');
    if (!gift.claimable) throw new ForbiddenException('Gift not claimable');
    if (gift.claimId) throw new ForbiddenException('Gift already claimed');

    const claim = this.claimRepo.create({
      giftId: gift.id,
      userEmail,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    });

    const savedClaim = await this.claimRepo.save(claim);
    gift.claimId = savedClaim.id;
    await this.giftRepo.save(gift);
    this.logger.log(`Gift claimed (giftId=${giftId}, claimId=${savedClaim.id})`);

    return savedClaim;
  }

  async unclaim(
    giftId: string,
    userEmail: string,
    context: GiftContext,
  ): Promise<GiftResponseDto> {
    this.logger.debug(`Removing gift claim (giftId=${giftId})`);
    const gift = await this.giftRepo.findOne({
      where: { id: giftId },
      relations: ['claims', 'tags'],
    });
    if (!gift) throw new NotFoundException('Gift not found');
    if (!gift.claimId) throw new ForbiddenException('Gift not claimed');

    const claim = await this.claimRepo.findOne({
      where: { id: gift.claimId, userEmail },
    });
    if (!claim) throw new ForbiddenException('Cannot unclaim: not owner');

    await this.claimRepo.remove(claim);
    gift.claimId = null;
    await this.giftRepo.save(gift);
    this.logger.log(`Gift unclaimed (giftId=${giftId})`);

    return this.toGiftResponse(gift, context);
  }

  toGiftResponse(gift: Gift, context: GiftContext): GiftResponseDto {
    const price = this.toPriceDto(gift, context);

    return {
      id: gift.id,
      createdAt: gift.createdAt,
      title:
        resolveLocalizedText(gift.titleLocalized, context.locale) ??
        'Untitled',
      description: resolveLocalizedText(
        gift.descriptionLocalized,
        context.locale,
      ),
      imageUrl: gift.imageUrl,
      claimable: gift.claimable,
      claimId: gift.claimId,
      tags: gift.tags?.map((tag) => this.toLocalizedTag(tag, context.locale)),
      claims: gift.claims,
      price,
    };
  }

  private toPriceDto(gift: Gift, context: GiftContext): GiftResponseDto['price'] {
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
    const userCurrency = context.userCurrency?.trim();
    const fallback = this.currencyService.getDefaultCurrency();

    return this.normalizeCurrency(headerCurrency ?? userCurrency ?? fallback);
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
      throw new BadRequestException(`${fieldName} must include at least one locale entry`);
    }
  }

  private async findGiftOrThrow(id: string): Promise<Gift> {
    const gift = await this.giftRepo.findOne({
      where: { id },
      relations: ['claims', 'tags'],
    });

    if (!gift) throw new NotFoundException('Gift not found');
    return gift;
  }
}
