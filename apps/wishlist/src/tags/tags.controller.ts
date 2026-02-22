import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Permissions, PermissionsGuard } from '@app/auth';
import { CursorPaginationDto } from '@app/common';
import { TagsService } from './tags.service';
import { resolveRequestLocale } from '../localization.util';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  findAll(
    @Query() pagination: CursorPaginationDto,
    @Headers('x-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.tagsService.findAll(
      pagination,
      resolveRequestLocale(localeHeader, acceptLanguage),
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'tag', scopes: ['create'] })
  create(
    @Body() data: { color?: string; titleLocalized?: unknown },
    @Headers('x-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.tagsService.create(
      data,
      resolveRequestLocale(localeHeader, acceptLanguage),
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'tag', scopes: ['edit'] })
  update(
    @Param('id') id: string,
    @Body() data: { color?: string; titleLocalized?: unknown },
    @Headers('x-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.tagsService.update(
      id,
      data,
      resolveRequestLocale(localeHeader, acceptLanguage),
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'tag', scopes: ['delete'] })
  remove(
    @Param('id') id: string,
    @Headers('x-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.tagsService.remove(
      id,
      resolveRequestLocale(localeHeader, acceptLanguage),
    );
  }
}
