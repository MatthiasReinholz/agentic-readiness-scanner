// Release version tooling, no dependencies.
//   --next <patch|minor|major|custom> [version]   print the next version
//   --verify <version>                            fail unless every surface carries it
//   --notes <version>                             print the changelog section for it
//   <version>                                     apply the bump to every surface
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const SEMVER = /^\d+\.\d+\.\d+$/;
const PACKAGE_FILES = [
  'package.json',
  'packages/catalog/package.json',
  'packages/core/package.json',
  'packages/mcp/package.json',
  'packages/cli/package.json',
  'packages/ui/package.json',
  'apps/web/package.json',
];
const VERSION_TS = 'packages/core/src/version.ts';
const CHANGELOG = 'CHANGELOG.md';

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function currentVersion() {
  return readJson('package.json').version;
}

function nextVersion(type, requested) {
  if (type === 'custom') {
    if (!SEMVER.test(requested ?? ''))
      throw new Error('custom release needs a version in x.y.z form');
    return requested;
  }
  const [major, minor, patch] = currentVersion().split('.').map(Number);
  switch (type) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      throw new Error(`unknown release type ${type}`);
  }
}

function changelogSection(version) {
  if (!SEMVER.test(version)) throw new Error(`invalid version ${version}`);
  const lines = readFileSync(join(root, CHANGELOG), 'utf8').split('\n');
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return '';
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## [')) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

function apply(version) {
  if (!SEMVER.test(version)) throw new Error(`invalid version ${version}`);
  for (const file of PACKAGE_FILES) {
    const path = join(root, file);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    json.version = version;
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  }
  const versionTs = readFileSync(join(root, VERSION_TS), 'utf8');
  writeFileSync(
    join(root, VERSION_TS),
    versionTs.replace(/SCANNER_VERSION = '[^']+'/, `SCANNER_VERSION = '${version}'`),
  );

  const changelog = readFileSync(join(root, CHANGELOG), 'utf8');
  const date = new Date().toISOString().slice(0, 10);
  if (!changelog.includes(`## [${version}]`)) {
    const updated = changelog.replace(
      /^## \[Unreleased\]\s*\n/m,
      `## [Unreleased]\n\n## [${version}] - ${date}\n\n`,
    );
    if (updated === changelog) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading');
    writeFileSync(join(root, CHANGELOG), updated);
  }
  console.log(`Bumped to ${version}`);
}

function verify(version) {
  const problems = [];
  for (const file of PACKAGE_FILES) {
    const actual = readJson(file).version;
    if (actual !== version) problems.push(`${file}: ${actual}`);
  }
  const versionTs = readFileSync(join(root, VERSION_TS), 'utf8');
  if (!versionTs.includes(`SCANNER_VERSION = '${version}'`))
    problems.push(`${VERSION_TS}: SCANNER_VERSION differs`);
  if (!readFileSync(join(root, CHANGELOG), 'utf8').includes(`## [${version}]`))
    problems.push(`${CHANGELOG}: no section for ${version}`);
  if (problems.length > 0) {
    console.error(`Version surfaces disagree with ${version}:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`All version surfaces carry ${version}`);
}

const [command, a, b] = process.argv.slice(2);
switch (command) {
  case '--next':
    console.log(nextVersion(a, b));
    break;
  case '--verify':
    verify(a);
    break;
  case '--notes':
    console.log(changelogSection(a) || `Release ${a}.`);
    break;
  case undefined:
    console.error(
      'usage: bump-version.mjs <version> | --next <type> [version] | --verify <version> | --notes <version>',
    );
    process.exit(1);
    break;
  default:
    apply(command);
}
