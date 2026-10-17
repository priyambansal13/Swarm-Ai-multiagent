import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/guards.js';
import { parse } from '../common/validate.js';
import { OpenAIMediaService } from '../integrations/openai-media.service.js';

@ApiTags('Voice')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('voice')
export class VoiceController {
  constructor(private readonly media: OpenAIMediaService) {}

  @Post('transcribe')
  @ApiOperation({ summary: 'Speech → text (push-to-talk). Body: base64 audio (webm/ogg/mp3/m4a/wav, ≤ 10 MB)' })
  @ApiBody({ schema: { example: { audio: '<base64>', mime: 'audio/webm' } } })
  async transcribe(@Body() body: unknown) {
    const b = parse(z.object({ audio: z.string().max(14_000_000), mime: z.string() }), body);
    return { text: await this.media.transcribe(Buffer.from(b.audio, 'base64'), b.mime) };
  }

  @Post('speak')
  @ApiOperation({ summary: 'Text → speech (MP3)' })
  @ApiBody({ schema: { example: { text: 'You have 3 meetings today.' } } })
  async speak(@Body() body: unknown, @Res() res: Response) {
    const b = parse(z.object({ text: z.string().min(1).max(4000) }), body);
    const audio = await this.media.speak(b.text.replace(/[*_`#>]/g, ''));
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  }
}
