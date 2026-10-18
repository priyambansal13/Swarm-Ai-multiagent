import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { User } from '../db/entities.js';
import type { OrgService } from '../orgs/org.service.js';
import { AuthService } from './auth.service.js';

/** AuthService with an in-memory user count; SIGNUP_MODE taken from `mode`. */
function service(mode: string | undefined, existingUsers: number, invite: { valid?: boolean; alreadyClaimed?: boolean } = {}) {
  const users = {
    count: vi.fn(async () => existingUsers),
    findOne: vi.fn(async () => null),
    create: vi.fn((u: Partial<User>) => u),
    save: vi.fn(async (u: Partial<User>) => ({ id: 'u1', ...u })),
  } as unknown as Repository<User>;
  const orgs = {
    createOrg: vi.fn(async () => ({ id: 'org-new' })),
    invite: vi.fn(async () => {
      if (invite.valid === false) throw new BadRequestException('This invitation is invalid or has expired.');
      return { inv: { code: 'INV1', role: 'agent', email: null }, org: { id: 'org-existing' } };
    }),
    claimInvite: vi.fn(async () => {
      if (invite.alreadyClaimed) throw new BadRequestException('This invitation is invalid or has expired.');
    }),
    releaseInvite: vi.fn(async () => undefined),
  } as unknown as OrgService;
  const config = { get: vi.fn(() => mode) } as unknown as ConfigService;
  return { auth: new AuthService(users, orgs, config), users, orgs };
}

const input = { email: 'new@example.com', password: 'a-long-password', name: 'New Person' };

describe('sign-up policy (SIGNUP_MODE)', () => {
  beforeAll(() => {
    process.env.APP_SECRET ??= 'test-secret-for-login-tokens'; // signToken needs one
  });

  it('is open by default', async () => {
    expect(await service(undefined, 5).auth.signupPolicy()).toEqual({ mode: 'open', open: true });
    await expect(service(undefined, 5).auth.signup(input)).resolves.toHaveProperty('token');
  });

  it('invite mode still lets the very first account be created', async () => {
    expect(await service('invite', 0).auth.signupPolicy()).toEqual({ mode: 'invite', open: true });
    await expect(service('invite', 0).auth.signup(input)).resolves.toHaveProperty('token');
  });

  it('invite mode blocks sign-up without an invitation once someone exists', async () => {
    expect(await service('invite', 1).auth.signupPolicy()).toEqual({ mode: 'invite', open: false });
    await expect(service('Invite ', 1).auth.signup(input)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invite mode accepts sign-up with an invitation', async () => {
    const res = await service('invite', 3).auth.signup({ ...input, invite: 'INV1' });
    expect(res.user).toMatchObject({ orgId: 'org-existing', role: 'agent' });
  });

  it('rejects an invalid or expired invitation', async () => {
    await expect(service('invite', 3, { valid: false }).auth.signup({ ...input, invite: 'BAD' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invitation that was just used by someone else (claimed atomically before the account is created)', async () => {
    const { auth, users } = service('invite', 3, { alreadyClaimed: true });
    await expect(auth.signup({ ...input, invite: 'INV1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('gives the invitation back if the account cannot be saved', async () => {
    const { auth, users, orgs } = service('invite', 3);
    vi.mocked(users.save).mockRejectedValueOnce(new Error('db down'));
    await expect(auth.signup({ ...input, invite: 'INV1' })).rejects.toThrow('db down');
    expect(orgs.releaseInvite).toHaveBeenCalledWith('INV1');
  });

  it.each(['invite-only', 'closed', 'INVITE_ONLY'])('an unknown SIGNUP_MODE (%s) fails closed to invite-only', async (mode) => {
    expect(await service(mode, 1).auth.signupPolicy()).toEqual({ mode: 'invite', open: false });
  });

  it.each(['', '  ', 'OPEN'])('empty or "open" (%j) means open', async (mode) => {
    expect((await service(mode, 1).auth.signupPolicy()).open).toBe(true);
  });
});
