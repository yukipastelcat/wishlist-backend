import { CursorPaginationDto } from '@app/common';

export class GiftListQueryDto extends CursorPaginationDto {
  search?: string;
  minPrice?: string | number;
  maxPrice?: string | number;
  // Reserved for upcoming tags multiselect support.
  tagIds?: string | string[];
}

