import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import type { EnvironmentConfig } from './config/config.interface';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: false,
  });

  const configService = app.get(ConfigService<EnvironmentConfig>);

  app.use(helmet.default());

  const corsOrigin = configService.get('corsOrigin', { infer: true })!;
  app.enableCors({
    origin: [corsOrigin, 'https://bskmt.com'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-TOKEN'],
    exposedHeaders: ['X-CSRF-TOKEN'],
    maxAge: 86400,
  });

  app.use(
    cookieParser.default(configService.get('csrfSecret', { infer: true })),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const port: number = configService.get('port', { infer: true })!;
  await app.listen(port);

  console.log(`BSKMT API running on port ${port}`);
}
void bootstrap();
