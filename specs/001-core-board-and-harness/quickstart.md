# Quickstart: Validating Feature 001

Prerequisites: Node ≥ 22; Linux or Windows (WSL2 dev acceptable but SC-007 runs on
both); no API key needed for any scenario except the AI-readiness ones. All tests are
headless (`npm test`, `npm run typecheck`) — the manual passes below are the
end-to-end proof of the success criteria.

## 1. Offline board (SC-002, FR-014/FR-015)

```bash
npm run dev
```

With **no provider configured, assistantRuntime off, and networking disabled**:
run US1 in full (≥ 10 tasks, two Lists, attachments + links, complete/reopen) and US2
(alarm 2 minutes out). Expect: every step works, zero outbound attempts (verify with a
proxy/monitor or the startup log), no error states. Then add a plain task to My Day —
the suggestion path must not fire (D7).

## 2. Alarms (SC-003, FR-008–FR-010)

Set alarms at +1 min (focused and minimized window), complete one before due, delete
another. Expect: exactly the surviving task notifies within 60 s; activating it opens
the task; completed/deleted ones stay silent. Quit the app past an alarm's time and
relaunch: the missed alarm presents **once, labeled overdue**; a second relaunch shows
nothing.

## 3. Lists (FR-006)

Create "Work" and "Personal"; assign tasks; move one between them; delete "Personal".
Expect: its tasks reappear unassigned in the all-tasks view, still complete-able —
never destroyed (this is the D3 regression test, run it deliberately).

## 4. Attachments (FR-002/003, SC-008)

Attach a markdown and a binary file to a task; move the originals to trash; reopen
from the task (US1-AC3). Attach an over-cap or unreadable file: refusal names the
reason, the task keeps its other content. Delete the confirmed task: attachment row
and stored copy are gone.

## 5. Secrets & readiness (FR-016/FR-020)

Settings → provider: paste a key, save; reload the app; inspect IPC payloads in the
devtools network/serialization trace — the full key must appear **nowhere**; the field
is write-only (empty save keeps it). Wrong key → "Check connection": state shows the
specific failure and the config survives (US3-AC3).

## 6. Portability (FR-021, SC-008)

With the app closed, copy the entire `<userData>` dir to a fresh location
(`--user-data-dir` style) or a second account/machine and launch. Expect: 100 % board
restore including attachment readability; first AI action asks for the secret once
(machine-fingerprint mismatch, D4), then works.

## 7. Bilingual & parity (FR-017/FR-018, SC-007)

`npm run typecheck` (catalog parity gate). Flip UI language; walk US1–US3 once in each.
Run the manual pass on both Linux and Windows; the automated suite:

```bash
npm test
npx tsx --test test/alarms.test.ts          # single file
npx tsx --test --test-name-pattern="overdue" test/*.test.ts
```

**Definition of green**: all three stories' acceptance scenarios unmodified on both
platforms, the offline test shows zero egress, and every guard named in
`contracts/core-board-ipc.md` fails on a deliberate violation (Principle IV).
