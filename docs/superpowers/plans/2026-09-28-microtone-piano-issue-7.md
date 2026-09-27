# Microtone Piano Settings Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure the latest settings are persisted when the page becomes hidden or exits, without changing the ordinary debounce behavior.

**Architecture:** Cache the opened IndexedDB handle in `StorageService` and use it directly to open the settings write transaction once initialization has completed. Keep the existing asynchronous fallback for first-open calls, and flush the debounced saver on `visibilitychange` before the existing `pagehide`/unmount fallback.

**Tech Stack:** TypeScript, React, IndexedDB, Node test runner via `tsx`, Vite.

**Spec:** Owner Issue #7 in `kinoko34077/microtone-piano`.

## Global Constraints

- Preserve the existing 180 ms ordinary settings debounce.
- Do not redesign tuning, samples, keyboard layout, PWA, or audio-engine behavior.
- Do not use a generation request or synthetic persistence timestamp as a lifecycle flush.
- Keep the existing `pagehide` and unmount flush paths.
- Treat arbitrary hard process termination as a separate browser limitation.

## Review Focus

- A settings save after the database is already open must open its write transaction synchronously; regression test covers transaction timing before the next microtask.
- First-open storage calls must retain the asynchronous IndexedDB fallback; existing storage behavior remains covered by typecheck/build.
- Repeated `flush()` calls must save exactly once; existing saver test remains green.
- Ordinary settings changes must still use the 180 ms debounce and must not flush from dependency cleanup; existing source-wiring test remains green.
- Hiding the document must flush pending settings while preserving keyboard-note release; source-wiring test records both lifecycle paths.

### Task 1: Add a failing transaction-timing regression test

**Files:**
- Modify: `tests/settings-flush.test.ts`
- Test: `tests/settings-flush.test.ts`

- [x] Export the storage service class for focused testing and add a fake IndexedDB test that initializes the database, calls `saveSettings`, and asserts the write transaction is opened before the returned promise's next microtask.
- [x] Run the focused test and confirm the new test fails because `saveSettings` currently awaits `initDB()` before opening the transaction; RED observed with 3 passing tests and the new timing assertion failing.

### Task 2: Implement the bounded lifecycle durability correction

**Files:**
- Modify: `src/core/storage.ts`
- Modify: `src/App.tsx`

- [x] Cache the successful `IDBDatabase` handle in `StorageService` while preserving the existing promise-based first-open path.
- [x] Route `saveSettings` through a synchronous transaction-start path whenever the cached handle exists.
- [x] Flush pending settings when the existing `visibilitychange` handler observes `document.hidden`, while retaining `pagehide` and unmount flushing.
- [x] Run the focused settings test and confirm the new regression passes.

### Task 3: Verify the repository-wide change

**Files:**
- Modify: `tests/settings-flush.test.ts`

- [x] Assert the visibility lifecycle wiring in the existing source-level test without weakening the debounce assertion.
- [x] Run the focused settings test.
- [x] Run all repository tests: 17 passed; run `tsc --noEmit`; run the Vite production build successfully.
- [x] Run `git diff --check` and inspect the exact diff.

### Task 4: Record the implementation milestone

- [x] Commit the plan, regression test, implementation, and verification updates on `fix/issue-7-indexeddb-exit-durability` (`f1aeaab37535eab9adf376e46f39f9d718e201ca`).
- [x] After commit, re-run the verification commands from the exact commit: 17 tests passed, `tsc --noEmit` passed, Vite production build passed, and `git diff --check` passed.
