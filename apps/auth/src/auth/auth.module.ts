import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from './refresh-token.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EMAIL_SERVICE } from './email/email.service';
import { YandexPostboxEmailAdapter } from './email/yandex-postbox-email.adapter';

@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([RefreshToken])],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: EMAIL_SERVICE,
      useClass: YandexPostboxEmailAdapter,
    },
  ],
})
export class AuthModule {}
