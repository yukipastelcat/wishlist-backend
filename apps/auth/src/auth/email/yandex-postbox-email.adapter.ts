import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import type { EmailService, SendEmailInput } from './email.service';

@Injectable()
export class YandexPostboxEmailAdapter implements EmailService {
  private readonly logger = new Logger(YandexPostboxEmailAdapter.name);
  private readonly accessKeyId = (
    process.env.POSTBOX_ACCESS_KEY_ID ?? ''
  ).trim();
  private readonly secretAccessKey = (
    process.env.POSTBOX_SECRET_ACCESS_KEY ?? ''
  ).trim();
  private readonly fromAddress = (process.env.POSTBOX_FROM_EMAIL ?? '').trim();
  private readonly endpoint = (
    process.env.POSTBOX_ENDPOINT ?? 'https://postbox.cloud.yandex.net'
  ).replace(/\/$/, '');
  private readonly region = (
    process.env.POSTBOX_REGION ?? 'ru-central1'
  ).trim();
  private readonly service = 'ses';

  async sendEmail(input: SendEmailInput): Promise<void> {
    if (
      !this.accessKeyId ||
      !this.secretAccessKey ||
      !this.fromAddress ||
      !input.to.trim()
    ) {
      this.logger.warn('Postbox email is not configured. Skipping email send.');
      return;
    }

    const url = new URL('/v2/email/outbound-emails', this.endpoint);
    const body = JSON.stringify({
      FromEmailAddress: this.fromAddress,
      Destination: {
        ToAddresses: [input.to.trim()],
      },
      Content: {
        Simple: {
          Subject: {
            Data: input.subject ?? 'Verification code',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: input.body,
              Charset: 'UTF-8',
            },
          },
        },
      },
    });

    const payloadHash = this.sha256Hex(body);
    const amzDate = this.formatAmzDate(new Date());
    const dateStamp = amzDate.slice(0, 8);

    const signedHeaders = 'content-type;host;x-amz-date';
    const canonicalHeaders = [
      'content-type:application/json',
      `host:${url.host}`,
      `x-amz-date:${amzDate}`,
      '',
    ].join('\n');

    const canonicalRequest = [
      'POST',
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');

    const signature = this.signString(stringToSign, dateStamp);
    const authorizationHeader =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-amz-date': amzDate,
        authorization: authorizationHeader,
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Postbox send failed (${response.status}): ${errorBody || 'No details'}`,
      );
      throw new InternalServerErrorException(
        'Failed to send verification email',
      );
    }
  }

  private signString(stringToSign: string, dateStamp: string): string {
    const kDate = this.hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, this.service);
    const kSigning = this.hmac(kService, 'aws4_request');
    return createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  }

  private hmac(key: string | Buffer, value: string): Buffer {
    return createHmac('sha256', key).update(value).digest();
  }

  private sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private formatAmzDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }
}
