/**
 * Node-only helpers for tests and the CLI: load a recorded store fixture from disk.
 * Kept on a separate export path so worker bundles never pull in node:fs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FixtureFetcher,
  type FixtureFetcherOptions,
  type FixtureResponse,
} from '../http/fixture-fetcher.js';

export * from './check-harness.js';

export interface FixtureManifestEntry {
  url: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  body_file?: string;
}

export interface FixtureManifest {
  /** The store origin the fixture represents, e.g. https://ceramics.example */
  origin: string;
  description?: string;
  responses: FixtureManifestEntry[];
}

export interface LoadedFixture {
  origin: string;
  description: string;
  responses: Record<string, FixtureResponse>;
}

export function loadFixtureDirectory(directory: string): LoadedFixture {
  const manifest = JSON.parse(
    readFileSync(join(directory, 'fixture.json'), 'utf8'),
  ) as FixtureManifest;
  const responses: Record<string, FixtureResponse> = {};
  for (const entry of manifest.responses) {
    const body = entry.body_file
      ? readFileSync(join(directory, entry.body_file), 'utf8')
      : (entry.body ?? '');
    responses[entry.url] = { status: entry.status ?? 200, headers: entry.headers ?? {}, body };
  }
  return { origin: manifest.origin, description: manifest.description ?? '', responses };
}

export function fixtureFetcher(
  directory: string,
  options: FixtureFetcherOptions = {},
): FixtureFetcher {
  return new FixtureFetcher(loadFixtureDirectory(directory).responses, options);
}
