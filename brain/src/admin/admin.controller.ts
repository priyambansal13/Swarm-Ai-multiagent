import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AgentConfigSchema, AgentRegistryService, CustomAgentSchema } from '../agents/registry.service.js';
import { AuthGuard, CurrentUser, RoleGuard } from '../auth/guards.js';
import { parse } from '../common/validate.js';
import { ADMIN_ROLES, type User } from '../db/entities.js';
import { KbFileSchema, KbTextSchema, KbUrlSchema, KnowledgeService } from '../knowledge/knowledge.service.js';
import { InviteSchema, OrgService, OrgUpdateSchema, publicOrg } from '../orgs/org.service.js';

/** Admin console API (owners and admins of the organisation). */
@ApiTags('Admin console')
@ApiBearerAuth()
@UseGuards(AuthGuard, RoleGuard(...ADMIN_ROLES))
@Controller('admin')
export class AdminController {
  constructor(private readonly orgs: OrgService, private readonly registry: AgentRegistryService, private readonly knowledge: KnowledgeService) {}

  // ------------------------------------------------------------------ organisation
  @Get('org')
  @ApiOperation({ summary: 'Organisation, branding, models and customer-desk settings (the API key is never returned)' })
  async org(@CurrentUser() user: User) {
    return publicOrg(await this.orgs.get(user.orgId));
  }

  @Patch('org')
  @ApiBody({ schema: { example: { name: 'Acme Dental', settings: { assistantName: 'Asha', desk: { enabled: true, instructions: 'We are a dental clinic in Pune…' } } } } })
  @ApiOperation({ summary: 'Update organisation settings; openaiApiKey "" removes the org key' })
  updateOrg(@CurrentUser() user: User, @Body() body: unknown) {
    return this.orgs.update(user.orgId, parse(OrgUpdateSchema, body));
  }

  @Get('usage')
  @ApiOperation({ summary: 'Members, conversations, actions per agent, knowledge size, desk status (last 30 days)' })
  usage(@CurrentUser() user: User) {
    return this.orgs.usage(user.orgId);
  }

  @Get('approvals')
  @ApiOperation({ summary: "Members' conversations waiting for an approval" })
  approvals(@CurrentUser() user: User) {
    return this.orgs.approvals(user.orgId);
  }

  @Get('audit')
  @ApiOperation({ summary: 'Audit log of all members (latest first)' })
  audit(@CurrentUser() user: User, @Query('limit') limit?: string) {
    return this.orgs.audit(user.orgId, Number(limit) || 200);
  }

  // ------------------------------------------------------------------ members & invites
  @Get('members')
  @ApiOperation({ summary: 'Members and their roles' })
  members(@CurrentUser() user: User) {
    return this.orgs.members(user.orgId);
  }

  @Patch('members/:id')
  @ApiBody({ schema: { example: { role: 'agent' } } })
  @ApiOperation({ summary: 'Change a role: owner | admin | agent (staff inbox) | member' })
  setRole(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    return this.orgs.setRole(user, id, parse(z.object({ role: z.enum(['owner', 'admin', 'agent', 'member']) }), body).role);
  }

  @Delete('members/:id')
  @ApiOperation({ summary: 'Remove a member (they keep their personal data in a new personal workspace)' })
  removeMember(@CurrentUser() user: User, @Param('id') id: string) {
    return this.orgs.remove(user, id);
  }

  @Get('invites')
  @ApiOperation({ summary: 'Open invitations' })
  invites(@CurrentUser() user: User) {
    return this.orgs.listInvites(user.orgId);
  }

  @Post('invites')
  @ApiBody({ schema: { example: { role: 'agent', email: 'asha@acme.in' } } })
  @ApiOperation({ summary: 'Invitation link (valid 7 days, single use)' })
  invite(@CurrentUser() user: User, @Body() body: unknown) {
    return this.orgs.createInvite(user, parse(InviteSchema, body));
  }

  @Delete('invites/:code')
  @ApiOperation({ summary: 'Revoke an invitation' })
  revokeInvite(@CurrentUser() user: User, @Param('code') code: string) {
    return this.orgs.revokeInvite(user.orgId, code);
  }

  // ------------------------------------------------------------------ agents (config-driven)
  @Get('agents')
  @ApiOperation({ summary: 'Effective agents (code defaults + org configuration) and the tool catalogue' })
  agents(@CurrentUser() user: User) {
    return this.registry.adminView(user.orgId);
  }

  @Put('agents/:agentId')
  @ApiBody({ schema: { example: { enabled: true, extraInstructions: 'Always answer in Hindi.', model: null, tools: null, approvalTools: ['add_task'], audience: 'staff' } } })
  @ApiOperation({ summary: 'Configure a built-in or custom agent' })
  configure(@CurrentUser() user: User, @Param('agentId') agentId: string, @Body() body: unknown) {
    return this.registry.upsert(user.orgId, agentId, parse(AgentConfigSchema, body));
  }

  @Post('agents')
  @ApiBody({ schema: { example: { agentId: 'faq', label: 'FAQ', description: 'Answers customer FAQs from the knowledge base', prompt: 'You answer customer questions using kb_search only…', tools: ['kb_search'], audience: 'customer' } } })
  @ApiOperation({ summary: 'Create a custom agent from catalogue tools' })
  create(@CurrentUser() user: User, @Body() body: unknown) {
    const { agentId, ...rest } = parse(CustomAgentSchema, body);
    return this.registry.upsert(user.orgId, agentId, rest, 'custom');
  }

  @Delete('agents/:agentId')
  @ApiOperation({ summary: 'Delete a custom agent, or reset a built-in agent to its defaults' })
  resetAgent(@CurrentUser() user: User, @Param('agentId') agentId: string) {
    return this.registry.reset(user.orgId, agentId);
  }

  @Get('packs')
  @ApiOperation({ summary: 'Industry packs (bundles of agent configuration and desk settings)' })
  packs() {
    return this.registry.packs().map(({ id, name, description, agents }) => ({ id, name, description, agents: agents.map((a) => a.agentId) }));
  }

  @Post('packs/:id/apply')
  @ApiOperation({ summary: 'Apply a pack to this organisation' })
  applyPack(@CurrentUser() user: User, @Param('id') id: string) {
    return this.registry.applyPack(user.orgId, id);
  }

  // ------------------------------------------------------------------ knowledge base
  @Get('knowledge')
  @ApiOperation({ summary: 'Knowledge sources and their status' })
  sources(@CurrentUser() user: User) {
    return this.knowledge.list(user.orgId);
  }

  @Post('knowledge/file')
  @ApiBody({ schema: { example: { name: 'refund-policy.pdf', mime: 'application/pdf', data: '<base64>' } } })
  @ApiOperation({ summary: 'Upload a PDF, Word (.docx), text, Markdown, CSV or HTML file (≤ 15 MB)' })
  addFile(@CurrentUser() user: User, @Body() body: unknown) {
    return this.knowledge.addFile(user, parse(KbFileSchema, body));
  }

  @Post('knowledge/url')
  @ApiBody({ schema: { example: { url: 'https://example.com/faq' } } })
  @ApiOperation({ summary: 'Add a public web page or PDF link' })
  addUrl(@CurrentUser() user: User, @Body() body: unknown) {
    return this.knowledge.addUrl(user, parse(KbUrlSchema, body));
  }

  @Post('knowledge/text')
  @ApiBody({ schema: { example: { name: 'Opening hours', text: 'Mon–Sat 9 am – 7 pm, closed Sundays.' } } })
  @ApiOperation({ summary: 'Add pasted text (FAQ answers, price list…)' })
  addText(@CurrentUser() user: User, @Body() body: unknown) {
    return this.knowledge.addText(user, parse(KbTextSchema, body));
  }

  @Post('knowledge/search')
  @ApiBody({ schema: { example: { query: 'refund for damaged items' } } })
  @ApiOperation({ summary: 'Test a search against the knowledge base' })
  search(@CurrentUser() user: User, @Body() body: unknown) {
    return this.knowledge.search(user.orgId, parse(z.object({ query: z.string().min(2).max(500) }), body).query, 6);
  }

  @Get('knowledge/:id/preview')
  @ApiOperation({ summary: 'First chunks of a source' })
  preview(@CurrentUser() user: User, @Param('id') id: string) {
    return this.knowledge.preview(user.orgId, id);
  }

  @Post('knowledge/:id/resync')
  @ApiOperation({ summary: 'Re-fetch a web page source' })
  resync(@CurrentUser() user: User, @Param('id') id: string) {
    return this.knowledge.resync(user.orgId, id);
  }

  @Delete('knowledge/:id')
  @ApiOperation({ summary: 'Delete a source and its chunks' })
  removeSource(@CurrentUser() user: User, @Param('id') id: string) {
    return this.knowledge.remove(user.orgId, id);
  }
}
