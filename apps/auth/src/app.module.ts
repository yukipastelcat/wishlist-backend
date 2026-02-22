import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { RefreshToken } from './auth/refresh-token.entity';
import * as fs from 'fs';

function resolveDbPassword(): string | undefined {
  const passwordFile = (process.env.DB_PASSWORD_FILE ?? '').trim();
  if (passwordFile) {
    try {
      return fs.readFileSync(passwordFile, 'utf-8').trim();
    } catch {
      // Fallback to DB_PASSWORD when file is unavailable.
    }
  }

  return (process.env.DB_PASSWORD ?? '').trim() || undefined;
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER,
      password: resolveDbPassword(),
      database: process.env.DB_NAME,
      entities: [RefreshToken],
      synchronize: true,
    }),
    AuthModule,
  ],
})
export class AppModule {}
