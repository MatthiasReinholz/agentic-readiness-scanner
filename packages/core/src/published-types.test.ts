import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function declarations(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? declarations(join(dir, entry.name))
      : entry.name.endsWith('.d.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

describe('published type declarations', () => {
  // The catalog and the visual system are private packages bundled into core, so the
  // declarations must carry their types instead of importing them.
  it('never import the private workspace packages', () => {
    const files = declarations(dist);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"]@agentic-readiness\//);
    }
  });
});
