import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';

export interface Attachment {
  name: string;
  mime: string;
  /** base64 (no data: prefix) */
  data: string;
}

/** OpenAI audio, vision and embeddings used across agents and channels. */
@Injectable()
export class OpenAIMediaService {
  private client?: OpenAI;
  constructor(private readonly config: ConfigService) {}

  private get openai() {
    return (this.client ??= new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') }));
  }

  get transcribeModel() {
    return this.config.get<string>('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-mini-transcribe';
  }

  /** Speech → text. Accepts OGG/Opus (Telegram, WhatsApp), WebM (browsers), MP3, M4A, WAV. */
  async transcribe(audio: Buffer, mime: string): Promise<string> {
    const ext = mime.includes('ogg') || mime.includes('opus') ? 'ogg' : mime.includes('webm') ? 'webm' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('wav') ? 'wav' : 'mp3';
    const file = await toFile(audio, `audio.${ext}`, { type: mime });
    const res = await this.openai.audio.transcriptions.create({ file, model: this.transcribeModel });
    return (res as { text: string }).text.trim();
  }

  /** Text → speech (MP3). */
  async speak(text: string): Promise<Buffer> {
    const res = await this.openai.audio.speech.create({
      model: this.config.get<string>('OPENAI_TTS_MODEL') || 'gpt-4o-mini-tts',
      voice: (this.config.get<string>('OPENAI_TTS_VOICE') || 'alloy') as any,
      input: text.slice(0, 3800),
      response_format: 'mp3',
    });
    return Buffer.from(await res.arrayBuffer());
  }

  /** Ask a vision-capable model about images (receipts, documents, screenshots). */
  async vision(instruction: string, images: Attachment[], json = false): Promise<string> {
    const res = await this.openai.chat.completions.create({
      model: this.config.get<string>('OPENAI_MODEL') || 'gpt-4.1',
      ...(json ? { response_format: { type: 'json_object' as const } } : {}),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          ...images.map((a) => ({ type: 'image_url' as const, image_url: { url: `data:${a.mime};base64,${a.data}` } })),
        ],
      }],
    });
    return res.choices[0]?.message?.content ?? '';
  }

  /** text-embedding-3-small (1536 dims). `apiKey` = an organisation's own key. */
  async embed(texts: string[], apiKey?: string): Promise<number[][]> {
    const client = apiKey ? new OpenAI({ apiKey }) : this.openai;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const res = await client.embeddings.create({ model: 'text-embedding-3-small', input: texts.slice(i, i + 96).map((t) => t.slice(0, 8000)) });
      out.push(...res.data.map((d) => d.embedding));
    }
    return out;
  }
}
