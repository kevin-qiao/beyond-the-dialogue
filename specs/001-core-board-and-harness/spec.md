# Feature Specification: Core Board and Agent Harness

**Feature Branch**: `feature/001-core-board-and-harness`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: `doc/specification/Specification.md` — the v1.0 milestone's *To-do list* and *Built-in agent* rows. The *Document type AI assistant* row is feature 002 by the milestone mapping agreed in ADR-0001; it is out of scope here.

## Clarifications

### Session 2026-10-04

- Q: Should task alarms still fire at their set time when the application is not running? → A: No — alarms fire while the application runs; missed alarms are presented once as overdue at next start (FR-008/FR-010 stand as written; OS-scheduled closed-app delivery is explicitly out of scope for this feature, not merely deferred by silence).
- Q: How must the saved access secrets for the model service (and any tool server) be protected while the app is closed? → A: User-account-private files on the user's own machine only — no operating-system credential store integration in this feature; the storage must never reveal the secret in full or send it anywhere but the service it authenticates (new FR-020).
- Q: What protection must exist for the accumulated board against disk loss or a move to another machine? → A: The application data folder *is* the board — copying it to a fresh setup restores everything except secrets, which are re-entered on use (new FR-021, SC-008). No dedicated export/import UI in this feature; that becomes worth its own design once 002's artifact formats exist.
- Q: What must happen when a user deletes a task — is deletion final, and is it protected against a mis-click? → A: Final but never accidental: one confirmation showing the task's title, then the task, its alarm, and its attachments are gone; no recoverable "recently deleted" area in this feature (FR-004 amended).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture and run my daily board (Priority: P1)

A user opens the application and gets their whole working day on a board: they add a
pending task in seconds (title only is enough), flesh it out later with its background,
its target, and any supporting material — links, files, free notes. Tasks live in named
Lists ("Work", "Personal", …) or unassigned, move between active and completed as the
day unfolds, and everything is still there tomorrow.

**Why this priority**: This is the product's reason to exist — an MS-To-Do-grade board
that richly describes each task. Without it nothing else has a host.

**Independent Test**: Run a full day of work on the board with AI never mentioned:
capture ≥ 10 tasks with attachments and links, group them into two Lists, complete
some, reopen one, restart the application, and verify nothing was lost.

**Acceptance Scenarios**:

1. **Given** the board, **When** the user adds a task with only a title, **Then** it is
   saved and visible in the active view immediately.
2. **Given** an existing task, **When** the user opens it, **Then** they can edit its
   background, target, and additional information (text, links, attached files) and see
   the saved result.
3. **Given** an attached file, **When** the original file is moved or deleted outside
   the application, **Then** the task's copy of the material still opens.
4. **Given** tasks in two Lists, **When** the user browses a List, **Then** they see
   exactly that List's tasks, and unassigned tasks are reachable in the all-tasks view.
5. **Given** an active task, **When** the user marks it completed, **Then** it leaves
   the active view, appears in the completed view, and can be reopened.
6. **Given** a restarted application, **When** the user opens any task, **Then** all
   content, state, List membership, and alarms are intact.

---

### User Story 2 - Get told at the right time (Priority: P2)

The user sets an alarm on a task ("16:45 — join the review"). At that moment a
notification appears naming the task, and activating it brings the user straight to
that task. Completing or deleting the task makes the pending alarm disappear.

**Why this priority**: The timed notification is the only proactive behavior the master
spec asks of the board; it is what makes a to-do list serve a working day rather than
merely record it.

**Independent Test**: Set alarms at near-future times on several tasks, complete one
and delete another before their alarms fall due, and observe: notifications only for
the surviving task, opening jumps to it, and nothing re-notifies after the app restarts.

**Acceptance Scenarios**:

1. **Given** a task, **When** the user sets an alarm (date + time), **Then** the task
   shows its alarm and the time can be changed or the alarm cancelled.
2. **Given** a due alarm while the application is running, **When** the alarm time is
   reached, **Then** a notification appears naming the task.
3. **Given** that notification, **When** the user activates it, **Then** the
   application opens or focuses and presents that task.
4. **Given** a task with a pending alarm, **When** the user completes or deletes the
   task before the time, **Then** the alarm no longer fires.
5. **Given** alarms whose time passed while the application was closed, **When** the
   user starts the application, **Then** the missed alarms are presented once as
   overdue rather than silently firing late.

---

### User Story 3 - Make the app AI-ready without using AI yet (Priority: P3)

The user configures the built-in agent once: connects a large-language-model service and
checks that it answers, registers skills and connects tool servers (MCP servers) they
will later grant to task types. With nothing configured, the board behaves exactly the
same — no gates, no nags, no outbound traffic — and the app states plainly that AI
assist is not set up. With it configured, readiness is visible at a glance.

**Why this priority**: The harness is the substrate every later assistant feature
stands on; making it configurable and honestly optional now keeps 002 purely about
assistance. Lower priority than the board itself because 001's value lands even before
anyone configures it.

**Independent Test**: With the network disabled, exercise US1 and US2 completely; then
connect, mis-connect, and remove an LLM service and observe validated / failed / not
configured states, and verify no skill or tool server is reachable by anything until a
type grants it (grants themselves arrive in a later feature).

**Acceptance Scenarios**:

1. **Given** a fresh install with AI unconfigured, **When** the user uses the board,
   **Then** no feature requires configuration and the app initiates no external calls
   for board operation.
2. **Given** the AI configuration area, **When** the user supplies LLM service access
   details and asks the app to check them, **Then** the app reports success or a
   specific failure, and remembers which it last reported.
3. **Given** a failed check, **When** the user saves the configuration anyway,
   **Then** it is kept, the failure stays visible, and nothing else changes.
4. **Given** skills and tool servers added by the user, **When** the user removes or
   disables one, **Then** the app reflects the change and nothing uses it afterwards.
5. **Given** configured AI, **When** the user looks at the board, **Then** AI
   readiness (configured / not configured / last check failed) is visible without
   digging.

---

### Edge Cases

- Alarm time chosen in the past → refused with a plain explanation.
- Alarm falls due while the app is minimized or hidden → the notification still appears
  (delivery only requires the application to be running, not in the foreground).
- System clock changes (travel, DST, manual adjustment) → alarms reschedule against the
  new clock; at most one late/missed presentation per alarm, never duplicates.
- A deleted List's tasks → they become unassigned rather than deleted.
- Renaming a List collides with another List's name → allowed; the two Lists stay
  distinct and their names are shown as entered.
- Attachment is huge or unreadable → rejected with a stated reason; the task keeps its
  other content.
- LLM service unreachable at check time → the check reports the failure; saved
  configuration is not silently discarded.
- Task deleted while its editor is open in another window → the deletion wins and the
  stale view closes rather than resurrecting content.
- Completing a task with a missed-but-unacknowledged alarm → completion consumes the
  alarm (no post-completion notifications).
- Empty states (no tasks, no Lists, no attachments) → the board invites capture rather
  than showing a blank pane.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let the user add a task with a title alone, and MUST
  require a non-empty title.
- **FR-002**: The system MUST let the user record, per task, a background, a target,
  and additional information as free text, links, and attached files.
- **FR-003**: The system MUST persist each attached file as the application's own copy
  so that moving, renaming, or deleting the original never breaks the task.
- **FR-004**: The system MUST let the user edit and delete any task. A deletion MUST be
  confirmed once — with the task's title shown — before it takes effect, then remove the
  task and its attachments from all views and cancel any pending alarm on it; deletion is
  final (no recoverable "recently deleted" area in this feature).
- **FR-005**: The system MUST track each task as active or completed, MUST let the user
  complete and reopen it, and MUST present the two states as separate views plus an
  all-tasks view.
- **FR-006**: The system MUST let the user create, rename, and delete Lists; each task
  belongs to at most one List; deleting a List unassigns its tasks without deleting
  them.
- **FR-007**: The system MUST let the user set, change, or cancel a one-time alarm
  (calendar date and time) on any task, and MUST reject an alarm time in the past.
- **FR-008**: While the application is running, the system MUST deliver a desktop
  notification naming the task when its alarm falls due, regardless of whether the
  window is focused.
- **FR-009**: The system MUST open or focus the application on the alarmed task when
  the user activates the notification.
- **FR-010**: The system MUST present alarms missed while the application was closed
  once, as overdue, at next start — never re-fired late or duplicated.
- **FR-011**: The system MUST keep tasks, Lists, alarms, attachments, and settings
  across application restarts, including alarms whose time has not yet arrived.
- **FR-012**: The system MUST let the user configure access to a large-language-model
  service, verify it on demand, report the outcome specifically (success, authentication
  failure, unreachable, bad response), and retain the configuration after a failed
  check.
- **FR-013**: The system MUST let the user register, disable, enable, and remove skills,
  and add, disable, and remove tool servers (MCP servers), all stored on the user's own
  machine.
- **FR-014**: The system MUST treat every registered skill and tool server as inert:
  nothing may reach through them until an explicit per-task-type grant exists (grants
  arrive with the assistance features), and the system MUST NOT grant itself access by
  mere presence of configuration.
- **FR-015**: The system MUST perform all board operation (US1, US2) with no AI
  configured, and while operating the board MUST NOT initiate outbound calls or use
  skills or tool servers.
- **FR-016**: The system MUST show AI readiness — not configured / configured and
  verified / configured but last check failed — in plain view from the board.
- **FR-017**: The system MUST present every piece of its own interface text in both
  English and Simplified Chinese, switchable by the user's setting.
- **FR-018**: The system MUST deliver the above equivalently on Linux and Windows
  desktops, including notification delivery.
- **FR-019**: The system MUST keep the user's task content on the user's machine; it
  leaves only when an explicit user-initiated assistance action sends it (from later
  features) — the board itself never transmits it.
- **FR-020**: The system MUST persist model-service and tool-server access secrets only
  in storage private to the user's own account on the user's machine, MUST NOT reveal a
  stored secret in full in any interface, and MUST NOT transmit a secret anywhere other
  than the service it authenticates to. Operating-system credential-store integration is
  out of scope for this feature.
- **FR-021**: The system MUST keep the entire board — tasks, Lists, attachments,
  settings, and history — within one user-accessible application data folder such that
  copying that folder to a fresh setup of the application reproduces the board
  completely, with nothing bound to the original machine except stored secrets, which
  are requested again on first use after a copy.

### Key Entities

- **Task**: a unit of the user's work — title (required), background, target,
  additional information (text, links, attachments), state (active/completed),
  timestamps, optional List membership, optional one-time alarm.
- **List**: a user-named grouping of tasks; zero or one List per task.
- **Alarm**: a single future date-time attached to a task; produces one notification;
  consumed by firing, cancellation, completion, or deletion.
- **Attachment**: a file the user added to a task, held as an application-owned copy.
- **Skill**: a reusable capability registered by the user for the built-in agent to
  use when later granted to it.
- **Tool server (Connector)**: an externally configured service the agent may reach
  only through a later per-task-type grant; managed by the user as app-level
  configuration.
- **Model service configuration**: the user's LLM service access details and the state
  of its last verification.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A returning user captures a titled task in under 10 seconds from the app
  being frontmost; adding background, a link, and an attachment takes under 60 seconds.
- **SC-002**: With networking disabled and AI never configured, users complete every
  US1 and US2 scenario with 0 blocked steps and 0 error states.
- **SC-003**: Across a 7-day daily-driver trial with the app running during work hours,
  at least 95 % of alarms present their notification within 60 seconds of the set time,
  and no alarm fires twice or after its task's completion or deletion.
- **SC-004**: A new user completes first-time AI readiness (add model service,
  verify successfully, register one skill, add one tool server) in under 5 minutes
  without external documentation.
- **SC-005**: Users locate a task created 7 days earlier within 30 seconds using only
  the views, List browsing, and task detail — without any search feature.
- **SC-006**: After quit-and-relaunch (including crash-restart), 100 % of tasks, Lists,
  attachment readability, and undelivered alarms are restored; each missed alarm
  re-presents exactly once.
- **SC-007**: The acceptance scenarios of all three stories pass unmodified on both
  Linux and Windows.
- **SC-008**: With the application closed, copying the data folder to a fresh setup
  restores 100 % of tasks, Lists, attachment readability, and settings; the first use of
  a configured AI service after the copy asks for its secret once, then works.

## Assumptions

- **Scope**: This is the first slice of the v1.0 milestone. AI assistance itself —
  task types, the three families, per-type grants in use, chat, document workflows —
  belongs to later features (starting with 002 Document assist) and is deliberately
  absent here; the harness is configured, verified, and honestly inert.
- **List membership**: at most one List per task (single home, MS-To-Do style); tasks
  without a List live in the all-tasks view. Multi-membership rejected as a v1
  complication, not a data-model limit to die on later.
- **Alarms**: one-time only (no recurrence, no snooze) and delivered only while the
  application is running; OS-scheduled delivery with the app closed is a future
  enhancement with its own decision — missed alarms surface as overdue instead.
- **Attachments**: the application owns its copies (consistent with the product's
  user-ownership value: the copy outlives the original's housekeeping); links are kept
  as references and opened externally; very large media files are out of spirit (a
  generous size guard will be chosen at planning).
- **One active model service**: the user may store several service configurations but
  exactly one is active for later assistance at any time; switching is cheap and
  explicit.
- **Single local user**: no accounts, no multi-user or sync; data is local (master spec:
  a personal desktop application).
- **Bilingual UI** is a standing product commitment from the redesign grilling; the
  mechanism for keeping the two languages complete is planning-phase material.
- **Platforms**: Linux and Windows desktops per the constitution's Principle V; no
  mobile, no web.
- **Terminology**: this spec uses the glossary in `CONTEXT.md` (List for grouping;
  "category" is retired; Connector and Grant as defined there).
