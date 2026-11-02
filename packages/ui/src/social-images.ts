/** Versioned, build-time social assets. Bump the filename version when changing a card. */
export const SOCIAL_IMAGE_WIDTH = 1200;
export const SOCIAL_IMAGE_HEIGHT = 630;

export const SOCIAL_IMAGES = {
  home: {
    path: '/social/scanner-v1.png',
    eyebrow: 'PUBLIC SIGNALS. PRACTICAL ANSWERS.',
    lines: ['IS YOUR STORE READY', 'FOR AI AGENTS?'],
    description: 'Find out what agents can discover, read and trust.',
    footer: 'A clear report. A fix for every finding.',
    alt: 'Agentic Readiness Scanner: Is your store ready for AI agents? Purple and lime lettering over a technical network.',
  },
  knowledge: {
    path: '/social/knowledge-v1.png',
    eyebrow: 'THE AGENTIC READINESS KNOWLEDGE BASE',
    lines: ['MAKE YOUR STORE', 'AGENT-READY.'],
    description: 'Understand the checks. Follow the evidence. Find the fix.',
    footer: 'Public standards, explained one check at a time.',
    alt: 'Agentic Readiness Scanner knowledge base: Make your store agent-ready. Purple and lime lettering over a technical network.',
  },
  report: {
    path: '/social/report-v1.png',
    eyebrow: 'YOUR AGENTIC READINESS REPORT',
    lines: ['PUBLIC SIGNALS.', 'CLEAR NEXT STEPS.'],
    description: 'Discover what agents can find, read and trust.',
    footer: 'Prioritized findings. Evidence. Actionable fixes.',
    alt: 'Agentic readiness report: Public signals, clear next steps. Purple and lime lettering over a technical network.',
  },
} as const;

export type SocialImageKind = keyof typeof SOCIAL_IMAGES;
