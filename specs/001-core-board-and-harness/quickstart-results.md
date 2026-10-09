# Quickstart Validation Record — feature 001

**Date**: 2026-10-08 · **Environment**: WSL2 Linux (development host) · **Branch**: `feature/001-implementation`

This is the honest split between what was validated automatically and what still
needs the human/platform passes named in `quickstart.md`. **Nothing below claims a
manual §1–§7 walkthrough happened** — those passes are for the reviewer, on a real
desktop, per the record's own rule ("works under WSL2" is not shipping evidence).

## Automated gates (all green at this commit)

- `npm run typecheck` (both named projects) — clean.
- `npm test` — 321 tests, 0 failures, headless (no Electron, no network, no key).
- i18n literal ratchet — baseline still **empty** (0 files / 0 literals); the
  `npx tsx test/helpers/i18nBaseline.ts` diff only ever shrank.

### Which success criteria the automated suite carries

| Criterion | Evidence |
|---|---|
| SC-002 (board works with AI unconfigured, zero egress) | `test/assistantSwitch.test.ts` — a full board day with keys stored and plugins registered constructs **nothing** at any counting seam (sessions, simple prompts, MCP factories all zero); `test/taskService.test.ts` — the switch-off enqueues are empty for plain/learning/meeting. |
| SC-003 (alarms fire once, never after completion/deletion) | `test/alarms.test.ts` — live fire consumed and never re-fires; missed-at-start raises exactly once labeled `overdue` with the original due time; completed and deleted tasks never re-raise; the clock-jump pin (forward presents once, backward never resurrects or duplicates) — the earlier draft of this pin passed vacuously and was rewritten to prove the fire happened. |
| SC-006 (100 % restore after relaunch, missed alarm once) | `test/board.test.ts` restart stage — tasks, membership, completion, alarm, attachment readability; `test/alarms.test.ts` restart case. |
| SC-007 (both platforms) | **NOT** automated — needs the Windows pass below. |
| SC-008 (folder copy restores the board; secret re-asks) | `test/portability.test.ts` — mechanical half: zero absolute-path values in `tasks`/`lists`/`settings`/`task_attachments`; copy + foreign fingerprint ⇒ `readSecrets().available === false`, `getProviderKey() === null`, board and attachment bytes restored from the copy alone. |
| Principle IV guard drills (T050) | Each verified to FAIL on a deliberate violation and reverted: `apiKey: string` added to `RedactedSettings` broke `npm run typecheck`; a `node:fs` import inside `src/core/domain/attachment.ts` broke `test/layering.test.ts`; a letter-initial English literal in `ListsRail.tsx` broke the `test/i18n.test.ts` ratchet; an `en` key missing from `zhCn.ts` broke the parity typecheck. **Known census limitation, recorded here because the drill found it:** the literal census sees JSX text only when it begins with a letter, so an emoji-prefixed label like `＋ New List Thing` is invisible to it (pre-existing; the `placeholder`/`title`/`aria-label`/`alt` attributes are still seen, and `notify('…')` strings are documented as out of its sight). |

## Still owed by a human (the quickstart's own list)

1. **§1–§7 manual walkthroughs** on a real desktop session, Linux and Windows, in
   both UI languages (`quickstart.md` steps 1–7). The board day, alarms incl.
   minimized-window delivery, List unassign regression, attachments incl.
   over-cap refusal wording, secrets devtools-inspection, folder copy to a second
   account/machine, bilingual sweep.
2. **Windows parity (Principle V / T053)**: notification delivery (§2), the
   secret-store posture (§5 — POSIX mode 0600 is not the Windows mechanism; the
   account ACL is, and `machineFingerprint` uses hostname+username precisely
   because `os.userInfo().uid` is −1 there), and the folder copy (§6) natively.
3. **§2 native-notification evidence on Linux**: the WSL2 dev host is excluded by
   the task's own caveat; run on a desktop session with `notify-daemon` present.

Append dated results to this file as each pass completes; do not check T052/T053
until it does.
