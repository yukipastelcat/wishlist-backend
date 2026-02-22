import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { Request, Response } from 'express';
import type { CookieOptions } from 'express';

class RequestCodeDto {
  email!: string;
}
class VerifyCodeDto {
  email!: string;
  code!: string;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  private getRefreshCookieOptions(): CookieOptions {
    const isProd = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      path: '/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }

  @Post('request-code')
  async requestCode(@Body() body: RequestCodeDto) {
    this.logger.log('Handling auth code request');
    await this.authService.requestCode(body.email);
    return { status: 'ok' };
  }

  @Post('verify-code')
  async verifyCode(
    @Body() body: VerifyCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log('Handling code verification');
    this.authService.verifyCode(body.email, body.code);

    const { accessToken, refreshToken } = await this.authService.issueTokens(
      body.email,
    );

    res.cookie('refreshToken', refreshToken, this.getRefreshCookieOptions());

    return { accessToken };
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshTokenFromCookies = req.cookies?.refreshToken as string;
    try {
      this.logger.log('Handling token refresh');
      const { accessToken, refreshToken } = await this.authService.refreshToken(
        refreshTokenFromCookies,
      );

      res.cookie('refreshToken', refreshToken, this.getRefreshCookieOptions());

      return { accessToken };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn('Token refresh failed, reason:' + message);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.logger.log('Handling logout');
    const refreshTokenFromCookies = req.cookies.refreshToken as string;
    await this.authService.logout(refreshTokenFromCookies);
    res.clearCookie('refreshToken', { path: '/auth/refresh' });
    return { status: 'ok' };
  }

  @Get('user')
  async getUser(@Req() req: Request) {
    this.logger.log('Handling current user request');
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] as string;

    const user = await this.authService.getUser(token);
    return user;
  }
}
