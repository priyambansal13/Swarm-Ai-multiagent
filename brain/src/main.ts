import './env.js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.useBodyParser('json', { limit: '20mb' }); // voice notes, photos and AG-UI state arrive as JSON/base64
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('SwarmAI Brain API')
    .setDescription(
      'Multi-agent personal assistant (LangGraph). Web app endpoints use a Bearer token from /api/auth/login; ' +
        'n8n endpoints (channels inbound, automations tick/ack) use the X-Swarm-Key header.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'api/docs-json', customSiteTitle: 'SwarmAI API docs' });

  const port = Number(process.env.PORT ?? 4200);
  await app.listen(port);
  Logger.log(`SwarmAI brain on http://localhost:${port}/api · Swagger /api/docs · AG-UI POST /api/agui`, 'Bootstrap');
}
await bootstrap();
