import { describe, expect, it } from 'vitest';
import { WANTS_HUMAN } from './desk.service.js';

describe('customer asks for a person', () => {
  it.each(['I want to talk to a human', 'can I speak to someone from your team?', 'agent', 'Human please', 'connect me to customer care executive', 'kisi se baat karni hai'])('"%s" → handoff', (t) => {
    expect(WANTS_HUMAN.test(t)).toBe(true);
  });
  it.each(['What are your timings?', 'Is the human body test available?', 'Do you have an agent in Pune for courier pickup', 'refund status'])('"%s" → bot answers', (t) => {
    expect(WANTS_HUMAN.test(t)).toBe(false);
  });
});
