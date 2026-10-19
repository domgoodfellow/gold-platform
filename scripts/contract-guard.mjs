#!/usr/bin/env node
// Makes contract-affecting changes visible and requires a written rationale for them
// (docs/decisions/README.md → Contract-change protocol; docs/testing.md → Test-change discipline).
//
// Two rules, checked per commit or per pull request:
//
//   1. A change to a protected contract path (the patterns in .github/CODEOWNERS) needs a line
//        Contract-Change: ADR-046            an ADR that exists and is Accepted at the head revision
//        Contract-Change: approved: <who/when/where the owner approved the changed behavior>
//        Contract-Change: correction: <the factual inaccuracy corrected; no behavior changes>
//   2. Removing or skipping test cases, or newly mocking a `@/features/` or `@/components/` module
//      in a test, needs a line
//        Coverage-Change: <the behavior the removed check protected, and why it no longer applies>
//
// It proves a rationale was written, never that it is true or that the change was authorized —
// that is a person's review. It blocks a merge only where branch protection requires the job.
//
// Usage:
//   node scripts/contract-guard.mjs --base origin/main [--head HEAD]          each commit's message
//   node scripts/contract-guard.mjs --base <sha> --head <sha> --body-file f    one rationale for the range
// In GitHub Actions with no --base, the pull_request or push event supplies the range and rationale.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIN_REASON = 15;
const ZERO_SHA = /^0+$/;

/** The path patterns of a CODEOWNERS file, in order. */
export function protectedPatterns(codeowners) {
  return codeowners
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0]);
}

/** CODEOWNERS (gitignore-style) matching for the subset this repository uses: `/` anchors, trailing `/`, `*`, `**`. */
export function matchesPattern(path, pattern) {
  const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');
  const directory = pattern.endsWith('/');
  const body = pattern.replace(/^\//, '').replace(/\/$/, '');
  const source = body
    .split('**')
    .map((part) => part.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*');
  const prefix = anchored ? '^' : '(^|/)';
  const suffix = directory ? '/' : '($|/)';
  return new RegExp(prefix + source + suffix).test(path);
}

export function isProtected(path, patterns) {
  return patterns.some((pattern) => matchesPattern(path, pattern));
}

export function isTestFile(path) {
  return /\.(test|spec)\.(ts|tsx|mjs)$/.test(path) || /(^|\/)test_[^/]+\.py$/.test(path);
}

/** Test declarations in one file's text. A missing file has none. */
export function countTests(source, path = '') {
  if (source == null) return { cases: 0, skips: 0, mocks: 0 };
  if (path.endsWith('.py')) {
    return {
      cases: (source.match(/^\s*(async\s+)?def test_/gm) ?? []).length,
      skips: (source.match(/@pytest\.mark\.(skip|xfail)\b/g) ?? []).length,
      mocks: 0,
    };
  }
  return {
    cases: (source.match(/(?<![.\w])(?:it|test)(?:\.concurrent)?\s*\(\s*['"`]/g) ?? []).length,
    skips: (source.match(/(?<![.\w])(?:it|test|describe)\.(?:skip|todo|fixme)\b|(?<![.\w])x(?:it|describe)\s*\(/g) ?? []).length,
    mocks: (source.match(/vi\.mock\(\s*['"`]@\/(?:features|components)\//g) ?? []).length,
  };
}

/** Every `Contract-Change:` and `Coverage-Change:` value in a commit message or pull request description. */
export function parseRationale(text) {
  const values = (key) => [...(text ?? '').matchAll(new RegExp(`^\\s*${key}:[ \\t]*(.*)$`, 'gim'))].map((match) => match[1].trim());
  return { contract: values('Contract-Change'), coverage: values('Coverage-Change') };
}

/**
 * Applies both rules to one unit of change.
 * `files`: { path, before, after } with file text at the base and head (null when absent).
 * `adrStatus(id)`: the Status word of `ADR-nnn` at the head revision, or null when there is no such ADR.
 */
export function evaluate({ files, rationale, patterns, adrStatus }) {
  const protectedChanged = files.filter((file) => isProtected(file.path, patterns)).map((file) => file.path);
  const coverageChanges = [];
  for (const file of files.filter((candidate) => isTestFile(candidate.path))) {
    const before = countTests(file.before, file.path);
    const after = countTests(file.after, file.path);
    const parts = [];
    if (after.cases < before.cases) parts.push(`${before.cases - after.cases} test case(s) removed`);
    if (after.skips > before.skips) parts.push(`${after.skips - before.skips} skip(s) added`);
    if (after.mocks > before.mocks) parts.push(`${after.mocks - before.mocks} feature/component mock(s) added`);
    if (parts.length) coverageChanges.push(`${file.path}: ${parts.join(', ')}`);
  }

  const { contract, coverage } = parseRationale(rationale);
  const errors = [];
  if (protectedChanged.length) {
    if (!contract.length) errors.push('Protected contract paths changed without a `Contract-Change:` line.');
    for (const value of contract) {
      const adrs = value.match(/\bADR-\d{3}\b/g);
      if (adrs) {
        for (const id of adrs) {
          const status = adrStatus(id);
          if (!status) errors.push(`\`Contract-Change:\` cites ${id}, which does not exist.`);
          else if (status !== 'Accepted') errors.push(`\`Contract-Change:\` cites ${id}, whose status is ${status}, not Accepted.`);
        }
      } else if (!/^(approved|correction):\s*\S/i.test(value) || value.replace(/^\w+:\s*/, '').length < MIN_REASON) {
        errors.push(`\`Contract-Change: ${value}\` must cite an Accepted ADR, or say \`approved: …\` or \`correction: …\` with a reason.`);
      }
    }
  }
  if (coverageChanges.length && !coverage.some((value) => value.length >= MIN_REASON)) {
    errors.push('Tests were removed, skipped or newly mocked without a `Coverage-Change:` line naming the behavior they protected.');
  }
  return { protectedChanged, coverageChanges, errors };
}

// ---- git plumbing -------------------------------------------------------------------------------

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

function show(revision, path) {
  try {
    return execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function changedFiles(base, head) {
  const lines = git('diff', '--name-status', '-M', base, head).split('\n').filter(Boolean);
  return lines.map((line) => {
    const [status, first, second] = line.split('\t');
    const path = second ?? first;
    const previous = status.startsWith('R') ? first : path;
    return { path, before: status.startsWith('A') ? null : show(base, previous), after: status.startsWith('D') ? null : show(head, path) };
  });
}

function adrStatusAt(revision) {
  const names = git('ls-tree', '--name-only', `${revision}:docs/decisions`).split('\n');
  return (id) => {
    const name = names.find((candidate) => candidate.startsWith(`${id}-`));
    if (!name) return null;
    const text = show(revision, `docs/decisions/${name}`) ?? '';
    return text.match(/\*\*Status:\*\*\s*([A-Za-z]+)/)?.[1] ?? 'Unknown';
  };
}

function units({ base, head, body }) {
  const patterns = protectedPatterns(show(head, '.github/CODEOWNERS') ?? '');
  if (body !== undefined) {
    const mergeBase = git('merge-base', base, head);
    return [{ label: `${mergeBase.slice(0, 7)}..${head.slice(0, 7)} (pull request description)`, ...evaluate({ files: changedFiles(mergeBase, head), rationale: body, patterns, adrStatus: adrStatusAt(head) }) }];
  }
  const commits = git('rev-list', '--reverse', '--no-merges', `${base}..${head}`).split('\n').filter(Boolean);
  return commits.map((commit) => {
    const parent = git('rev-parse', `${commit}^`);
    const label = `${commit.slice(0, 7)} ${git('log', '-1', '--format=%s', commit)}`;
    // Each commit is judged by the ADRs as they stand at that commit, and by its own protected-path
    // list, or the head's when the commit predates CODEOWNERS.
    const own = protectedPatterns(show(commit, '.github/CODEOWNERS') ?? '');
    return { label, ...evaluate({ files: changedFiles(parent, commit), rationale: git('log', '-1', '--format=%B', commit), patterns: own.length ? own : patterns, adrStatus: adrStatusAt(commit) }) };
  });
}

function argumentsFromEnvironment(argv) {
  const value = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const bodyFile = value('--body-file');
  const options = { base: value('--base'), head: value('--head') ?? 'HEAD', body: bodyFile ? readFileSync(bodyFile, 'utf8') : undefined };
  if (options.base || !process.env.GITHUB_EVENT_PATH) return options;
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (event.pull_request) return { base: event.pull_request.base.sha, head: event.pull_request.head.sha, body: event.pull_request.body ?? '' };
  if (event.after) return { base: ZERO_SHA.test(event.before ?? '0') ? `${event.after}^` : event.before, head: event.after, body: undefined };
  return options;
}

function report(results) {
  const lines = ['## Contract guard', ''];
  for (const result of results) {
    if (!result.protectedChanged.length && !result.coverageChanges.length) continue;
    lines.push(`### ${result.label}`);
    if (result.protectedChanged.length) lines.push('Protected contract paths changed:', ...result.protectedChanged.map((path) => `- \`${path}\``));
    if (result.coverageChanges.length) lines.push('Coverage changes:', ...result.coverageChanges.map((change) => `- ${change}`));
    lines.push(...(result.errors.length ? result.errors.map((error) => `**Missing:** ${error}`) : ['Rationale present.']), '');
  }
  if (lines.length === 2) lines.push('No protected contract paths or coverage reductions in this change.');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = argumentsFromEnvironment(process.argv.slice(2));
  if (!options.base) {
    console.error('contract-guard: give --base <revision> (for example --base origin/main), or run inside a GitHub pull_request/push event.');
    process.exit(2);
  }
  const results = units(options);
  const text = report(results);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.exit(results.some((result) => result.errors.length) ? 1 : 0);
}
