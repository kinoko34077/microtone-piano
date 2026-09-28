# Microtone Piano Settings Persistence Authority Repair

> **For agentic workers:** implement against owner Issue #9 and keep the existing Issue #7/#8 lifecycle flush contract intact.

**Goal:** Prevent uncertain IndexedDB reads and failed asynchronous writes from silently becoming a clean/default settings state.

**Architecture:** Make settings startup reads return explicit authority states (`loaded`, `absent`, `read_failed`). Keep defaults usable in memory after `read_failed`, but hold autosave until an authoritative read succeeds. Model the debounced saver as a single in-flight writer whose latest revision remains pending until a write succeeds.

**Tech Stack:** TypeScript, React, IndexedDB, Node test runner via `tsx`, Vite.

**Spec:** Owner Issue #9 in `kinoko34077/microtone-piano`.

## Global Constraints

- Preserve the 180 ms ordinary settings debounce.
- Preserve Issue #7/#8 page lifecycle flush behavior.
- Do not redesign tuning, audio, samples, keyboard layout, or PWA behavior.
- A failed/read-uncertain startup may use defaults for UI continuity but must not treat them as authoritative persisted settings.
- Failed saves must remain retryable; newer revisions supersede older revisions deterministically without overlapping writes.
- Use only fake IndexedDB or an isolated temporary browser profile for failure/persistence verification.

## State Contract

- `loaded`: a settings record was read successfully; it is authoritative and autosave may run.
- `absent`: the settings store was read successfully and the record is absent; defaults may be initialized through the normal debounced save path.
- `read_failed`: the persisted state is unknown; defaults may render, but autosave is disabled and a visible retry is required.
- `save_failed`: the attempted revision remains pending and the visible retry flushes the same latest revision again.
- In-flight supersession: while revision N is saving, revision N+1 may become pending but must not start a concurrent write; after N settles, the latest pending revision is attempted.

## Verification

- RED: 4 existing settings tests passed and 4 new Issue #9 regressions failed before implementation.
- Focused GREEN: `npx tsx --test tests/settings-flush.test.ts` => 8/8.
- Repository regression: `npx tsx --test tests/*.test.ts` => 21/21.
- Type check: `npm run lint` (`tsc --noEmit`) => pass.
- Production build: `npm run build` => pass.
- Whitespace gate: `git diff --check` => pass.
- Real-browser smoke: isolated temporary Chrome profile proved empty-store default initialization, persisted settings load, save, and reload recovery (`masterVolume 0.8 -> 0.61`).

## UI / Accessibility Scope

The only new UI is a compact system-state alert with a native retry `<button>`. It uses `role="alert"`, textual failure state rather than color alone, and does not alter the primary keyboard workflow or page structure.
