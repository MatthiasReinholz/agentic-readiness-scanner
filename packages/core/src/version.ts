/** Scanner version, recorded in every result. Bumped by scripts/release/bump-version.mjs. */
export const SCANNER_VERSION = '0.4.0';

/** Honest user agent for every request the scanner makes on its own behalf. */
export const DEFAULT_USER_AGENT = `AgenticReadinessScanner/${SCANNER_VERSION} (+https://github.com/MatthiasReinholz/agentic-readiness-scanner)`;
