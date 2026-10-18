import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../common/crypto.js';
import { DEFAULT_SETTINGS, User, UserSettings } from '../db/entities.js';
import { OrgService } from '../orgs/org.service.js';

export const SignupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(80),
  timezone: z.string().optional(),
  /** Join an existing organisation */
  invite: z.string().trim().max(20).optional(),
  /** Name of the new organisation (when not joining one) */
  orgName: z.string().trim().min(1).max(80).optional(),
});
export const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
export const SettingsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().optional(),
  settings: z.object({
    briefTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    briefEnabled: z.boolean().optional(),
    notifyChannel: z.enum(['web', 'telegram', 'whatsapp']).optional(),
    voiceReplies: z.boolean().optional(),
    newsTopics: z.array(z.string().max(60)).max(10).optional(),
    homeCity: z.string().max(80).nullable().optional(),
    triageEnabled: z.boolean().optional(),
    meetingPrepEnabled: z.boolean().optional(),
  }).optional(),
});

const TOKEN_TTL = 30 * 24 * 3600;

export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, timezone: u.timezone, settings: u.settings, orgId: u.orgId, role: u.role });

@Injectable()
export class AuthService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>, private readonly orgs: OrgService) {}

  private validTz(tz?: string) {
    if (!tz) return 'Asia/Kolkata';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch {
      throw new BadRequestException(`Unknown timezone ${tz}`);
    }
  }

  async signup(input: z.infer<typeof SignupSchema>) {
    if (await this.users.findOne({ where: { email: input.email } })) throw new ConflictException('An account with this email already exists');
    const timezone = this.validTz(input.timezone);
    // Join the inviting organisation, or start a new one as its owner.
    const invited = input.invite ? await this.orgs.invite(input.invite) : null;
    if (invited?.inv.email && invited.inv.email !== input.email) throw new BadRequestException('This invitation is for a different email address.');
    const org = invited?.org ?? (await this.orgs.createOrg(input.orgName || `${input.name.split(' ')[0]}'s workspace`, timezone));
    const user = await this.users.save(this.users.create({
      email: input.email, name: input.name, passwordHash: hashPassword(input.password), timezone, settings: { ...DEFAULT_SETTINGS },
      orgId: org.id, role: invited?.inv.role ?? 'owner',
    }));
    if (invited) await this.orgs.useInvite(invited.inv.code);
    return { token: signToken({ sub: user.id }, TOKEN_TTL), user: publicUser(user) };
  }

  async login(input: z.infer<typeof LoginSchema>) {
    const user = await this.users.findOne({ where: { email: input.email } });
    if (!user || !verifyPassword(input.password, user.passwordHash)) throw new UnauthorizedException('Wrong email or password');
    return { token: signToken({ sub: user.id }, TOKEN_TTL), user: publicUser(user) };
  }

  async userFromToken(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const payload = verifyToken<{ sub: string }>(token);
    return payload ? this.users.findOne({ where: { id: payload.sub } }) : null;
  }

  async updateSettings(user: User, input: z.infer<typeof SettingsSchema>) {
    if (input.name) user.name = input.name;
    if (input.timezone) user.timezone = this.validTz(input.timezone);
    if (input.settings) user.settings = { ...DEFAULT_SETTINGS, ...user.settings, ...input.settings } as UserSettings;
    return publicUser(await this.users.save(user));
  }
}
