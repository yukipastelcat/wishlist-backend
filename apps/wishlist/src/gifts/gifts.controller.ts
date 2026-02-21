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
import { JwtAuthGuard, OptionalJwtAuthGuard, Permissions, PermissionsGuard } from '@app/auth';
import { GiftsService } from './gifts.service';
import type { Request } from 'express';
import { TokenPayload } from '@app/common/token-payload.type';
import { resolveRequestLocale } from '../localization.util';
import { GiftListQueryDto } from './gift-list-query.dto';

@Controller('gifts')
export class GiftsController {
  constructor(private giftsService: GiftsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  findAll(
    @Query() query: GiftListQueryDto,
    @Headers('x-currency') targetCurrency?: string,
    @Headers('x-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
    @Req() req?: Request & { user?: TokenPayload },
  ) {
    const isAdmin = this.isAdminUser(req?.user);
    return this.giftsService.findAll(query, {
      targetCurrency,
      userCurrency: req?.user?.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
      requesterEmail: req?.user?.email,
      isAdmin,
    });
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(
    @Param('id') id: string,
    @Headers('x-currency') targetCurrency?: string,
    @Headers('x-locale') localeHeader?: string,
    @Headers('accept-language') acceptLanguage?: string,
    @Req() req?: Request & { user?: TokenPayload },
  ) {
    const isAdmin = this.isAdminUser(req?.user);
    return this.giftsService.findOne(id, {
      targetCurrency,
      userCurrency: req?.user?.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
      requesterEmail: req?.user?.email,
      isAdmin,
    });
  }

  @Get(':id/edit-data')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions({ resource: 'gift', scopes: ['edit'] })
  findOneForEdit(@Param('id') id: string) {
    return this.giftsService.findOneForEdit(id);
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
    const isAdmin = this.isAdminUser(req.user);
    return this.giftsService.create(data, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
      requesterEmail: req.user.email,
      isAdmin,
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
    const isAdmin = this.isAdminUser(req.user);
    return this.giftsService.update(id, data, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
      requesterEmail: req.user.email,
      isAdmin,
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
    const isAdmin = this.isAdminUser(req.user);
    return this.giftsService.remove(id, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
      requesterEmail: req.user.email,
      isAdmin,
    });
  }

  @Post(':id/reserve')
  @UseGuards(JwtAuthGuard)
  reserve(
    @Param('id') id: string,
    @Headers('x-currency') targetCurrency: string | undefined,
    @Headers('x-locale') localeHeader: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() req: Request & { user: TokenPayload },
  ) {
    const isAdmin = this.isAdminUser(req.user);
    return this.giftsService.reserve(id, req.user.email, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
      requesterEmail: req.user.email,
      isAdmin,
    });
  }

  @Post(':id/unreserve')
  @UseGuards(JwtAuthGuard)
  unreserve(
    @Param('id') id: string,
    @Headers('x-currency') targetCurrency: string | undefined,
    @Headers('x-locale') localeHeader: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() req: Request & { user: TokenPayload },
  ) {
    const isAdmin = this.isAdminUser(req.user);
    return this.giftsService.unreserve(id, req.user.email, {
      targetCurrency,
      userCurrency: req.user.currency,
      locale: resolveRequestLocale(localeHeader, acceptLanguage),
      requesterEmail: req.user.email,
      isAdmin,
    });
  }

  private isAdminUser(user?: TokenPayload): boolean {
    if (!user?.permissions) return false;
    return user.permissions.some(
      (permission) =>
        permission.resource === 'gift' && permission.scopes.includes('create'),
    );
  }
}
