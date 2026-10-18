import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, mixin, Type, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { OrgRole, User } from '../db/entities.js';
import { AuthService } from './auth.service.js';

/** Bearer-token guard for the web app / API clients. Attaches `req.user`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query?.token as string | undefined);
    const user = await this.auth.userFromToken(token);
    if (!user) throw new UnauthorizedException('Sign in required');
    req.user = user;
    return true;
  }
}

/** Shared-secret guard for calls from n8n (channels, scheduler). Header: X-Swarm-Key. */
@Injectable()
export class N8nGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const given = Buffer.from(String(ctx.switchToHttp().getRequest().headers['x-swarm-key'] ?? ''));
    const expected = Buffer.from(process.env.SWARM_N8N_TOKEN ?? '');
    if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Invalid X-Swarm-Key');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user);

/** Use after AuthGuard: `@UseGuards(AuthGuard, RoleGuard('owner', 'admin'))`. */
export function RoleGuard(...roles: OrgRole[]): Type<CanActivate> {
  class RoleGuardMixin implements CanActivate {
    canActivate(ctx: ExecutionContext) {
      const user: User | undefined = ctx.switchToHttp().getRequest().user;
      if (!user || !roles.includes(user.role)) throw new ForbiddenException(`Needs role: ${roles.join(' or ')}`);
      return true;
    }
  }
  return mixin(RoleGuardMixin);
}
