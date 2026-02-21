import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Query,
  Headers,
} from '@nestjs/common';
import { JwtAuthGuard, Permissions, PermissionsGuard } from '@app/auth';
import { CursorPaginationDto } from '@app/common';
import { GiftsService } from './gifts.service';
import type { Request } from 'express';
import { TokenPayload } from '@app/common/token-payload.type';
import { resolveRequestLocale } from '../localization.util';

@Controller('gifts')
export class GiftsController {
  constructor(private giftsService: GiftsService) {}

  @Get()
  findAll(
    @Query() pagination: CursorPaginationDto,
    @Headers('x-currency') targetCurrency?: string,
    @Headers('x-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
    @Req() req?: Request & { user?: TokenPayload },
  ) {
    return this.giftsService.findAll(pagination, {
      targetCurrency,
      userCurrency: req?.user?.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'gift', scopes: ['create'] })
  create(
    @Body() data: Partial<any>,
    @Headers('x-currency') targetCurrency: string | undefined,
    @Headers('x-locale') localeHeader: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.giftsService.create(data, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
    });
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'gift', scopes: ['edit'] })
  update(
    @Param('id') id: string,
    @Body() data: Partial<any>,
    @Headers('x-currency') targetCurrency: string | undefined,
    @Headers('x-locale') localeHeader: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.giftsService.update(id, data, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'gift', scopes: ['delete'] })
  remove(
    @Param('id') id: string,
    @Headers('x-currency') targetCurrency: string | undefined,
    @Headers('x-locale') localeHeader: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.giftsService.remove(id, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
    });
  }

  @Post(':id/claim')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'giftClaim', scopes: ['create'] })
  claim(@Param('id') id: string, @Req() req: Request & { user: TokenPayload }) {
    return this.giftsService.claim(id, req.user.email);
  }

  @Post(':id/unclaim')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'giftClaim', scopes: ['delete'] })
  unclaim(
    @Param('id') id: string,
    @Headers('x-currency') targetCurrency: string | undefined,
    @Headers('x-locale') localeHeader: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.giftsService.unclaim(id, req.user.email, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
    });
  }
}
