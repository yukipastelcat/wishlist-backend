import { Module } from '@nestjs/common';
import { EMAIL_SERVICE } from './email.service';
import { YandexPostboxEmailAdapter } from './yandex-postbox-email.adapter';

@Module({
  providers: [
    {
      provide: EMAIL_SERVICE,
      useClass: YandexPostboxEmailAdapter,
    },
  ],
  exports: [EMAIL_SERVICE],
})
export class NotificationsModule {}
