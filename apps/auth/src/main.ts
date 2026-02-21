import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const feOrigin = process.env.FE_ORIGIN?.trim();
  const feDomain = process.env.FE_DOMAIN?.trim();
  const inferredOrigin = feDomain ? `https://${feDomain}` : undefined;
  const allowedOrigins = [feOrigin, inferredOrigin].filter(
    (value): value is string => Boolean(value),
  );

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('Auth server API')
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Paste your JWT access token here',
    })
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory);

  app.use(cookieParser());
  await app.listen(3000);
}

void bootstrap();
