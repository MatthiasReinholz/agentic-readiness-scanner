export * from './schema.js';
export * from './result.js';
export * from './prompt.js';
export { catalog } from './generated/catalog.js';

import { catalog } from './generated/catalog.js';
import type { Catalog, CheckDefinition, Group, Level, Profile } from './schema.js';

export function getCheck(id: string): CheckDefinition | undefined {
  return catalog.checks.find((check) => check.id === id);
}

export function getGroup(id: string): Group | undefined {
  return catalog.groups.find((group) => group.id === id);
}

export function getProfile(id: string): Profile | undefined {
  return catalog.profiles.find((profile) => profile.id === id);
}

export function levelsAscending(): Level[] {
  return [...catalog.levels].sort((a, b) => a.value - b.value);
}

/** Checks that apply to a profile, in catalog order. */
export function checksForProfile(profile: Profile, source: Catalog = catalog): CheckDefinition[] {
  return source.checks.filter((check) => {
    const group = source.groups.find((candidate) => candidate.id === check.group);
    if (!group || !profile.dimensions.includes(group.dimension)) return false;
    return !check.requires.some((requirement) =>
      profile.unsatisfied_requirements.includes(requirement),
    );
  });
}
