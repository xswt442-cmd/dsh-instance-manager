---
name: pr
description: "Use when drafting or revising a pull request title or body from actual repository changes. Read the repository PR template, explain the final implementation, write an evidence-grounded bilingual completed-task checklist, and report real verification. Do not use for changelogs or release notes."
metadata:
  credits:
    skill: show-me
    author: Dex Horthy
    organisation: Humanlayer
    url: "https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md"
---

# PR: clear structure, useful explanation

Write a PR that a reviewer can understand without reconstructing the whole diff. **Keep the structure light; give the changes enough substance.**

## One format source

1. Read the repository's `.github/PULL_REQUEST_TEMPLATE.md` (or its selected template under `.github/PULL_REQUEST_TEMPLATE/`) first. Honor applicable `AGENTS.md` and repository documentation rules.
2. **The repository template owns section names, language order, and required fields.** This skill owns how to investigate and fill those fields. Do not introduce a competing PR format, or copy this skill's fallback layout over an existing template.
3. Follow explicit user instructions where compatible with repository policy. If no template exists, use the lightweight fallback at the end.
4. Draft and revise locally unless the user has authorized creating or editing the remote PR. Do not assume permission to commit, push, switch branches, merge, or alter CI settings.

## Establish the facts

- Inspect the intended base/head branches, commit history, diff summary, and relevant code or documentation. Use the actual PR diff (for example, `git diff <base>...<head>`), not a summary inferred only from commit messages.
- For an existing PR, read its current description before revising it. Preserve verified facts, remove outdated claims, and avoid losing context that still matters.
- Check test/build output and CI status when available. Distinguish **passed**, **failed**, **not run**, and **still running**. Never turn a command's existence into a claim that it passed.
- Do not include private paths, hosts, tokens, logs, secrets, internal handoff notes, or temporary local environment details.

## Explain what changed

The **Changes / 变更** section is the main explanation, not a second checklist.

- Open with the purpose and the user-visible or engineering outcome.
- Explain the **final implementation**: important behavior, where responsibility lives, how relevant parts interact, and any current compatibility or safety constraints. State a design trade-off only if it helps review the actual change.
- For an ordinary PR, a short opening paragraph plus a few informative sentences or grouped bullets is usually enough. For a cross-module PR, use several focused paragraphs when needed. **Do not enforce a rigid word limit or collapse substantial changes into one vague sentence.**
- Mention relevant components, contracts, or file paths only when they help reviewers locate the change. Avoid enumerating every touched file.
- Explain the implementation, **not the development process**: no debugging diary, discarded approaches, speculative roadmap, or exaggerated claims.
- Be specific and readable in both languages; keep identifiers, commands, and file names unchanged.

## Completed task checklist

- Where the repository template includes Tasks / 任务, use Markdown checkboxes in **both** languages. Prefer **3–6 meaningful completed items** for a normal PR; use fewer for tiny changes, more only when justified.
- Mark `- [x]` **only** when the implementation or check is actually complete and supported by the diff, test output, or supplied evidence. Each item should name a concrete result or scope.
- Keep checklist items short and easy to scan. Put explanations in Changes and commands/results in Verification instead of repeating them in every checkbox.
- Under a completed-work PR standard, do **not** add `- [ ]`, post-merge plans, skipped validation, or unrelated future work to pad the list. Track future work in Issues. Unpassed required checks remain visible in CI/review gates, not falsely checked off.
- Complete the entire Chinese section first, then the entire English section. Corresponding checklist items must have the same meaning, order, and checked state.

## Verification

- List actual passing checks with their relevant command, scope, and concise result (for example, `npm test` — 42 passed). Include manual checks only if performed.
- Do not confuse a local build or unit test with live production validation. Do not claim pending CI has passed.
- If required checks are failed or unavailable, do not fabricate success or describe the PR as ready to merge. State the blocker to the user; let CI and review gates enforce it. Do not insert invented completed tasks.
- Prefer a concise evidence summary over raw console logs.

## Visuals and risk, only when useful

- **No diagram by default.** Add at most one compact diagram or diff sketch when a nontrivial control flow, cross-service boundary, state transition, or directory restructure would otherwise be hard to understand.
- If a diagram is useful, prefer Mermaid for flow or interaction; otherwise use a small relevant code/diff excerpt. Never add illustrations just to fill a section.
- Screenshots, before/after evidence, and impact/rollback notes are **optional**, not mandatory sections. Include them only for a genuine review need or when required by the repository template. Explain material risks in the relevant existing section rather than imposing "Merge Danger" or "Blast Radius" fields.

## Final review before sending

- Template headings and order preserved; Chinese and English facts align.
- Changes explain **why, what, and how**, with detail proportionate to complexity.
- Checklist items describe only completed work; Verification cites only checks that actually passed.
- No leaked private context, fictitious tests, plans masquerading as completed work, or mandatory decorative diagrams.
- If editing a remote PR, reread its rendered body and confirm the intended title and scope.

## Fallback when the repository has no PR template

Use `## 简体中文` with `### 变更`, `### 任务`, `### 验证`; then `## English` with `### Changes`, `### Tasks`, `### Verification`.

Give Changes enough prose to explain the actual implementation; use `- [x]` for genuinely completed work, and keep Verification limited to observed passing results. Do not create empty placeholder claims.
