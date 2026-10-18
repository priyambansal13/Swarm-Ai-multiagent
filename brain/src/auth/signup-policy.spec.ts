import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { User } from '../db/entities.js';
import type { OrgService } from '../orgs/org.service.js';
import { AuthService } from './auth.service.js';

/** AuthService with an in-memory user count; SIGNUP_MODE taken from `mode`. */
function service(mode: string | undefined, existingUsers: number) {
  const users = {
    count: vi.fn(async () => existingUsers),
    findOne: vi.fn(async () => null),
    create: vi.fn((u: Partial<User>) => u),
    save: vi.fn(async (u: Partial<User>) => ({ id: 'u1', ...u })),
  } as unknown as Repository<User>;
  const orgs = {
    createOrg: vi.fn(async () => ({ id: 'org-new' })),
    invite: vi.fn(async () => ({ inv: { code: 'INV1', role: 'agent', email: null }, org: { id: 'org-existing' } })),
    useInvite: vi.fn(async () => undefined),
  } as unknown as OrgService;
  const config = { get: vi.fn(() => mode) } as unknown as ConfigService;
  return new AuthService(users, orgs, config);
}

const input = { email: 'new@example.com', password: 'a-long-password', name: 'New Person' };

describe('sign-up policy (SIGNUP_MODE)', () => {
  beforeAll(() => {
    process.env.APP_SECRET ??= 'test-secret-for-login-tokens'; // signToken needs one
  });

  it('is open by default', async () => {
    expect(await service(undefined, 5).signupPolicy()).toEqual({ mode: 'open', open: true });
    await expect(service(undefined, 5).signup(input)).resolves.toHaveProperty('token');
  });

  it('invite mode still lets the very first account be created', async () => {
    expect(await service('invite', 0).signupPolicy()).toEqual({ mode: 'invite', open: true });
    await expect(service('invite', 0).signup(input)).resolves.toHaveProperty('token');
  });

  it('invite mode blocks sign-up without an invitation once someone exists', async () => {
    expect(await service('invite', 1).signupPolicy()).toEqual({ mode: 'invite', open: false });
    await expect(service('Invite ', 1).signup(input)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invite mode accepts sign-up with an invitation', async () => {
    const res = await service('invite', 3).signup({ ...input, invite: 'INV1' });
    expect(res.user).toMatchObject({ orgId: 'org-existing', role: 'agent' });
  });
});
