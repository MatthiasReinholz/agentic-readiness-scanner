export * from './schema.js';
export * from './result.js';
export * from './prompt.js';
export * from './platforms.js';
export { catalog } from './generated/catalog.js';

import { catalog } from './generated/catalog.js';
import type { Catalog, CheckDefinition, Group, Law, Level, Profile } from './schema.js';

/** A readiness or legal-signals check by id. */
export function getCheck(id: string): CheckDefinition | undefined {
  return (
    catalog.checks.find((check) => check.id === id) ??
    catalog.legal.checks.find((check) => check.id === id)
  );
}

export function getGroup(id: string): Group | undefined {
  return (
    catalog.groups.find((group) => group.id === id) ??
    catalog.legal.groups.find((group) => group.id === id)
  );
}

export function getLaw(id: string): Law | undefined {
  return catalog.legal.laws.find((law) => law.id === id);
}

/**
 * The legal-signals checks as a catalog of their own, so the runner and the reporters
 * can treat them like any group of checks without mixing them into readiness.
 */
export function legalCatalog(source: Catalog = catalog): Catalog {
  return {
    ...source,
    groups: source.legal.groups,
    checks: source.legal.checks,
    levels: source.levels,
  };
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
    // Legal signals apply to every profile unless it excludes a check.
    if (!group || (group.dimension !== 'legal' && !profile.dimensions.includes(group.dimension)))
      return false;
    if (profile.excluded_checks.includes(check.id)) return false;
    return !check.requires.some((requirement) =>
      profile.unsatisfied_requirements.includes(requirement),
    );
  });
}
