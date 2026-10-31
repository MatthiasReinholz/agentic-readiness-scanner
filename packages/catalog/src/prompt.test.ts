import { describe, expect, it } from 'vitest';

import { AGENT_WORKING_RULES, composeAgentPrompt } from './prompt.js';
import { catalog } from './index.js';

describe('composeAgentPrompt', () => {
  const check = catalog.checks.find((item) => item.id === 'A1.5');
  if (!check) throw new Error('A1.5 missing from catalog');

  it('wraps the task in context, specs and working rules', () => {
    const prompt = composeAgentPrompt(check, {
      targetUrl: 'https://shop.example',
      scannedAt: '2026-10-31T10:00:00.000Z',
      platform: 'woocommerce',
      verdict: 'fail',
      message: 'no /llms.txt (404)',
      reportUrl: 'https://scanner.example/r/0123456789abcdef',
    });
    expect(prompt.startsWith('# Fix request: A1.5 ')).toBe(true);
    expect(prompt).toContain('## Why you are receiving this');
    expect(prompt).toContain('https://shop.example on 2026-10-31 (detected platform: woocommerce)');
    expect(prompt).toContain('Observation: no /llms.txt (404)');
    expect(prompt).toContain('Full report: https://scanner.example/r/0123456789abcdef');
    expect(prompt).toContain('## What the check looks for');
    for (const ref of check.spec) expect(prompt).toContain(ref.url);
    expect(prompt).toContain('## Your task');
    expect(prompt).toContain(check.fix.agent_prompt);
    expect(prompt).toContain('## How to work');
    AGENT_WORKING_RULES.forEach((rule, index) => {
      expect(prompt).toContain(`${index + 1}. ${rule}`);
    });
  });

  it('reads well without any scan context', () => {
    const prompt = composeAgentPrompt(check);
    expect(prompt).toContain('A scan found that the check');
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('Observation:');
  });
});
