import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Which model answers is one decision, made in one place.
 *
 * `platform_ai_runtime_assignments` says which provider, account and model answers each AI
 * capability, and `apps/api` is the only runtime that reads it and holds a credential. Configuration
 * drafting once read its own `ANTHROPIC_API_KEY` in this runtime and named a model in source -- a
 * third answer to a question that has one -- so what is asserted here is the absence: nothing in
 * `apps/web` names a model vendor's SDK, a model id, or a model credential.
 *
 * A source scan, because the claim is structural: a model id is a string, and a string is how it
 * would come back the next time somebody is in a hurry.
 */

const WEB = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['node_modules', '.next', 'tests', 'e2e', 'scripts', 'coverage']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry) || entry.startsWith('.')) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    const generated = entry.endsWith('.generated.ts') || entry === 'database.types.ts';
    return /\.(ts|tsx|mjs)$/.test(entry) && !generated ? [path] : [];
  });
}

const files = sources(WEB).map((path) => ({
  path: relative(WEB, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

/** Code only: a comment may name a vendor to say why it is not here. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('no model is chosen or credentialled in apps/web', () => {
  it('reads no model credential from the environment', () => {
    const offenders = files.filter((file) =>
      /\b(ANTHROPIC|OPENAI|GEMINI|GOOGLE_GENAI|ASSISTANT)_API_KEY\b/.test(code(file.text)),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('imports no model vendor SDK', () => {
    const offenders = files.filter((file) =>
      /from\s+['"](@anthropic-ai\/sdk|openai|@google\/genai|@google\/generative-ai|ollama)['"]/.test(code(file.text)),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('names no model id', () => {
    const offenders = files.filter((file) =>
      /['"`](claude-[a-z0-9.-]+|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|llama[0-9][a-z0-9.:-]*)['"`]/i.test(code(file.text)),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('declares no dependency on a model vendor SDK', () => {
    const manifest = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(names.filter((name) => /anthropic|^openai$|genai|generative-ai/.test(name))).toEqual([]);
  });

  it('drafts through apps/api and reaches it the way answering does', () => {
    const registry = files.find((file) => file.path === 'lib/adapters/drafting/registry.ts')!;

    expect(registry.text).toContain('ASSISTANT_API_URL');
    expect(registry.text).toContain("import('./gold-api')");
  });
});

describe('the capability list is written once per runtime and pinned to the database', () => {
  it('names the three capabilities the database accepts', () => {
    const runtime = files.find((file) => file.path === 'lib/domain/ai/runtime.ts')!;

    expect(runtime.text).toContain(
      "['operator_assistant', 'public_assistant', 'configuration_drafting'] as const",
    );
  });
});
