---
description: Review the branch's UI changes against the AGENTS.md UI rules and the ui-system.md Core rules. Read-only.
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git merge-base:*), Bash(git status:*), Bash(node scripts/check-ui-copy.mjs:*)
argument-hint: "[base branch, default main]"
---

Review the UI changes on this branch. This command is read-only: do not edit, create, stage or delete any file, and do not commit. Report only.

1. Read the rules first: the "UI rules" section of `AGENTS.md` and "Core rules" at the top of `docs/ui-system.md`. If a changed file belongs to a workspace or feature, also read its spec in `docs/surfaces/`.
2. Find the changes: the base is `$ARGUMENTS` if given, otherwise `main`. Run `git merge-base HEAD <base>`, then `git diff <merge-base>...HEAD` plus `git diff` for uncommitted work. Keep UI files only: `.tsx` under `apps/` and `packages/` that render something. The rules cover operator surfaces (workspaces, Settings, Setup, Platform). Public surfaces (the marketing site, public customer pages, tenant website renderers, sign-in) follow `docs/public-web.md`, so do not hold them to these rules.
3. Run `node scripts/check-ui-copy.mjs` and keep its findings that fall in changed lines.
4. Read each changed hunk and judge it against every rule, including the ones the script cannot see:
   - an eyebrow (small, uppercase or letter-spaced label) above a page, section, panel or card heading; a group label over list items is allowed;
   - a subtitle or description under a heading that fails the content test ("what decision would be worse without this text?");
   - copy that restates a label, describes a feature, or fills a surface because it looks empty;
   - explanation that is heavier than needed (clearer label, then inline helper, then info popover, then empty state, then documentation), or a paragraph on the working surface;
   - a tooltip on anything but an icon-only control or nonessential clarification; an info icon on every row;
   - feedback after an action that is not a toast; a persistent alert for something that is not unresolved, account-affecting or safety-critical; critical information only in a tooltip, a toast or a colour;
   - a container (card, panel, list, surface variant) changed or invented instead of following the shared components and Appearance presets;
   - a `ui-copy-allow:` comment without a reason that satisfies the rules.
5. Report each violation on its own line as `path:line — rule broken — the text or element at fault`, most serious first. Group nothing away; if there are none, say so in one line. Do not suggest rewritten copy unless asked, and do not fix anything.
