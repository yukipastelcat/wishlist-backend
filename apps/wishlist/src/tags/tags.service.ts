import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  applyCursorPagination,
  CursorPaginatedResponse,
  CursorPaginationDto,
} from '@app/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from '../gifts/tag.entity';
import { parseLocalizedTextMap, resolveLocalizedText } from '../localization.util';
import { TagResponseDto } from './tag-response.dto';

type TagWriteInput = {
  color?: string;
  titleLocalized?: unknown;
};

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(@InjectRepository(Tag) private readonly tagRepo: Repository<Tag>) {}

  async findAll(
    pagination: CursorPaginationDto,
    locale?: string,
  ): Promise<CursorPaginatedResponse<TagResponseDto>> {
    this.logger.debug(
      `Listing tags (limit=${pagination.limit ?? 'default'}, hasCursor=${Boolean(
        pagination.cursor,
      )})`,
    );
    const result = await applyCursorPagination<Tag>(
      this.tagRepo.createQueryBuilder('tag'),
      {
        cursor: pagination.cursor,
        limit: pagination.limit,
      },
    );
    this.logger.debug(`Tag list completed with ${result.data.length} results`);
    return {
      ...result,
      data: result.data.map((tag) => this.toTagResponse(tag, locale)),
    };
  }

  async create(data: TagWriteInput, locale?: string) {
    const parsedTitleLocalized = parseLocalizedTextMap(
      data.titleLocalized,
      'titleLocalized',
    );
    this.ensureNonEmptyLocalizedField(parsedTitleLocalized, 'titleLocalized');

    const tag = this.tagRepo.create();
    tag.titleLocalized = parsedTitleLocalized;
    if (Object.prototype.hasOwnProperty.call(data, 'color')) {
      tag.color = data.color ?? '';
    }
    const created = await this.tagRepo.save(tag);
    this.logger.log(`Tag created (tagId=${created.id})`);
    return this.toTagResponse(created, locale);
  }

  async update(id: string, data: TagWriteInput, locale?: string) {
    this.logger.debug(`Updating tag (tagId=${id})`);
    const tag = await this.tagRepo.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('Tag not found');

    if (Object.prototype.hasOwnProperty.call(data, 'color')) {
      tag.color = data.color ?? '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'titleLocalized')) {
      const parsedTitleLocalized = parseLocalizedTextMap(
        data.titleLocalized,
        'titleLocalized',
      );
      this.ensureNonEmptyLocalizedField(parsedTitleLocalized, 'titleLocalized');
      tag.titleLocalized = parsedTitleLocalized;
    }

    this.ensureNonEmptyLocalizedField(tag.titleLocalized, 'titleLocalized');
    const updated = await this.tagRepo.save(tag);
    this.logger.log(`Tag updated (tagId=${id})`);
    return this.toTagResponse(updated, locale);
  }

  async remove(id: string, locale?: string) {
    this.logger.debug(`Removing tag (tagId=${id})`);
    const tag = await this.tagRepo.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('Tag not found');

    const removed = await this.tagRepo.remove(tag);
    this.logger.log(`Tag removed (tagId=${id})`);
    return this.toTagResponse(removed, locale);
  }

  private toTagResponse(tag: Tag, locale?: string): TagResponseDto {
    const title = resolveLocalizedText(tag.titleLocalized, locale) ?? 'Untitled';
    return {
      id: tag.id,
      createdAt: tag.createdAt,
      title,
      color: tag.color,
    };
  }

  private ensureNonEmptyLocalizedField(
    value: Record<string, string> | undefined,
    fieldName: string,
  ): asserts value is Record<string, string> {
    if (!value || Object.keys(value).length === 0) {
      throw new BadRequestException(`${fieldName} must include at least one locale entry`);
    }
  }
}
