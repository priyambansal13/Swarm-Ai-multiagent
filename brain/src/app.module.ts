import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActionExecutor } from './agents/actions.js';
import { SwarmGraphService } from './agents/graph.service.js';
import { AguiController } from './agui/agui.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AuthGuard, N8nGuard } from './auth/guards.js';
import { AutomationsController } from './automations/automations.controller.js';
import { AutomationsService } from './automations/automations.service.js';
import { ChannelsController } from './channels/channels.controller.js';
import { ChannelsService } from './channels/channels.service.js';
import { ChatController } from './chat/chat.controller.js';
import { ChatService } from './chat/chat.service.js';
import { ENTITIES } from './db/entities.js';
import { CalendarService } from './google/calendar.service.js';
import { GmailService } from './google/gmail.service.js';
import { GoogleAuthService } from './google/google-auth.service.js';
import { GoogleController } from './google/google.controller.js';
import { SheetsService } from './google/sheets.service.js';
import { HealthController } from './health/health.controller.js';
import { ImdWarningsService } from './integrations/imd-warnings.service.js';
import { N8nChannelsService } from './integrations/n8n-channels.service.js';
import { OpenAIMediaService } from './integrations/openai-media.service.js';
import { SearchService } from './integrations/search.service.js';
import { WeatherService } from './integrations/weather.service.js';
import { WebReaderService } from './integrations/web-reader.service.js';
import { YatraService } from './integrations/yatra.service.js';
import { RecordsController } from './records/records.controller.js';
import { RecordsService } from './records/records.service.js';
import { VoiceController } from './voice/voice.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'postgres',
        url: c.getOrThrow<string>('DATABASE_URL'),
        entities: ENTITIES,
        synchronize: true, // dev convenience; use migrations in production
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  controllers: [
    AuthController, GoogleController, ChatController, AguiController, RecordsController, VoiceController,
    ChannelsController, AutomationsController, HealthController,
  ],
  providers: [
    AuthService, AuthGuard, N8nGuard,
    GoogleAuthService, GmailService, CalendarService, SheetsService,
    OpenAIMediaService, SearchService, WebReaderService, WeatherService, ImdWarningsService, YatraService, N8nChannelsService,
    RecordsService, ActionExecutor, SwarmGraphService, ChatService, ChannelsService, AutomationsService,
  ],
})
export class AppModule {}
