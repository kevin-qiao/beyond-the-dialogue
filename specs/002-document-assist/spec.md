# Feature Specification: Document Type AI Assistant

**Feature Branch**: `feature/002-document-assist`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: `let's trigger the 002 feature spec` — the v1.0 milestone's *Document type AI assistant* row of `docs/specification/Specification.md`, assigned to feature 002 by the milestone mapping in ADR-0001. Feature 001 delivered the board and an inert, configured harness; this feature lights the first assistance family: **Document** — writing done in the application, organized by the assistant, kept in user-owned knowledge, and question-able at any time.

## Clarifications

### Session 2026-10-09 (pending — see [NEEDS CLARIFICATION] markers)

- Q1: How far does this feature take the master spec's "save into the path with LLM-wiki support" promise, and what happens to the three reference-implementation engines (learning / jira / meeting) it must decide the fate of?
- Q2: Do per-Type grants become live in this feature, or does every Document assist run without external reach?
- Q3: Which built-in Document Types ship?

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write a document in the board, finish it filed and organized (Priority: P1)

A user adds a task of a Document Type ("draft the weekly study blog", "today's diary",
"article on WSL2 networking") and works on it in the task's **working area**: a writing
space on the task where they put their own words over as many sittings as the work takes,
alongside the task's background, target, and attachments. Nothing leaves the machine
while they write. When the work is done, Finish is the whole close-out: the assistant
re-organizes the draft as the Type's instruction describes and files the result at the
location the Type declares, and the task shows completed with a plain record of where
the result went. The user's own draft is never destroyed or replaced by the filing — the
filed copy is what the destination receives; the task keeps the original words.

**Why this priority**: This is the master specification's Document row in one motion —
"you just need to write in this application, and the written content will be
well-organized … and save into the path". Every other story here hangs off this loop.

**Independent Test**: Create a Document task, draft a structured-but-messy piece over
three sessions across a restart, Finish, and verify: the filed copy exists at the type's
declared location, the draft still reads as written on the task, the task is complete,
and repeating the Finish for a same-titled second task creates a new file beside the
first rather than touching it.

**Acceptance Scenarios**:

1. **Given** a task of a Document Type, **When** the user writes in its working area and
   returns later (after reopening the task or restarting the application), **Then** the
   draft is exactly as they left it.
2. **Given** a Document task with a drafted piece and the assistant configured, **When**
   the user finishes it, **Then** an organized copy of the user's own piece is filed at
   the Type's declared destination, the task shows completed, and the result states
   where the copy was filed.
3. **Given** an existing file at the destination with the same name, **When** the user
   finishes, **Then** a distinctly named new file is created and no existing file is
   overwritten or moved.
4. **Given** the assistant switched off or never configured, **When** the user finishes,
   **Then** the user's own draft is filed as written, the task completes, nothing
   contacted any external service, and the app plainly says the organizing step did not
   run.
5. **Given** a Type whose destination is not usable (no location set, or the folder no
   longer exists), **When** the user finishes, **Then** the finish is refused with a
   concrete, actionable reason, and the task stays actionable — it is never completed
   half-filed, and never filed to a silently different place.
6. **Given** a task whose working area is still blank, **When** the user finishes,
   **Then** nothing is filed, the task stays active, and the app explains that there is
   no written content yet.

---

### User Story 2 - Ask about the work in front of me, any time (Priority: P2)

While the piece is still in progress, the user converses with the assistant **about this
task**: "what is this draft missing?", "is my argument for X consistent?", "pull out the
open questions". The conversation is grounded in that task's own material — background,
target, declared inputs, and the words written in the working area — so answers engage
with what the user actually has, not generic advice. Conversations belong to the task,
survive restarts, and can be started fresh. Chat is never a filing step: leaving a
conversation files nothing and completes nothing.

**Why this priority**: The master spec's "meanwhile you can ask AI anytime, and AI can
give you more insights according to your context" is what makes the working area an
assistant rather than a text box — but it is assistance around US1's loop, not the loop
itself.

**Independent Test**: With a drafted task, hold a multi-turn conversation, restart the
application mid-work, and verify the history returns intact; verify with AI not
configured that the conversation area states plainly why it is unavailable and every
other flow (writing, finishing as-is filing) still works; verify a question about one
task never quotes another task's content into what the model service receives.

**Acceptance Scenarios**:

1. **Given** a Document task with a draft and the assistant configured, **When** the
   user asks a question about the work, **Then** the reply engages with the task's
   actual content (it can quote or reference what the user wrote).
2. **Given** an in-progress conversation, **When** the application restarts, **Then**
   the conversation is presented again with the task, in order.
3. **Given** the assistant is off or unconfigured, **When** the user opens the
   conversation area, **Then** the app says plainly that it is not set up and why, and
   writing, finishing, and the rest of the board are unaffected.
4. **Given** a conversation, **When** the user starts a new one, **Then** a fresh
   conversation begins while the old history remains retrievable with the task.

---

### User Story 3 - My Type, my workflow: user-defined Document Types (Priority: P3)

The Document family is what the **Types** declare, and built-ins hold no privilege. A
user creates their own Type in Settings: names it, gives it the assistant instruction
their work needs ("file my diary as date-prefixed notes, keep a feelings section"),
declares the inputs its tasks ask for and the destination its results go to — and tasks
of that Type then run the same write → organize → file loop with the user's own
instruction, exactly as a built-in would. Editing a Type changes what happens from the
next assistance onward; it never rewrites artifacts already filed.

**Why this priority**: The type-engine promise (the constitution's Principle I) is that
users extend the product without forking it. It is P3 because US1 already delivers the
value end-to-end with built-ins alone, and the customization rides on the same
declarations.

**Independent Test**: Create a custom Type with its own instruction and destination, run
one task through it, verify the filed artifact follows the user's instruction; then edit
the instruction and finish a second task, verifying the change applies going forward and
the first artifact is untouched; try to save a destination-less Type and get an
actionable refusal.

**Acceptance Scenarios**:

1. **Given** the Type configuration area, **When** the user defines a Document-family
   Type with an instruction, inputs, and a destination, **Then** a task of that Type
   offers the working area and the finish loop using that declaration.
2. **Given** a Type declaration that names a destination with no location, **When** the
   user saves it, **Then** the save is refused with a specific reason.
3. **Given** a filed artifact from an older version of a Type, **When** the user edits
   the Type and finishes another task, **Then** only the new finish changes; filed
   artifacts are never updated by the application.
4. **Given** a Type in use by existing tasks, **When** the user removes it, **Then** the
   tasks keep their content and are reassigned or clearly flagged — nothing silently
   loses its workflow.

---

### Edge Cases

- The assistant returns an empty, malformed, or wholly-fabricated document (content the
  user never wrote) → the user's draft is filed as written and the organizing step is
  reported as failed; a broken assistant never changes the user's words.
- The destination folder is deleted or unmounted between saving the Type and finishing →
  finish is refused with an actionable reason; the task stays actionable (covered by
  US1 scenario 5, restated here as the general rule for every destination loss).
- The user finishes, reopens the task, edits the draft, and finishes again → a second
  distinctly named artifact is filed; earlier artifacts are never updated or removed.
- The model service is switched or reconfigured mid-conversation → the history is kept
  and the conversation continues on the new service; the reply language is the model's
  own, never forced by the interface language.
- A very long conversation or a very large draft → the assistance still works or says
  what it cannot do; writing and as-is filing never fail because of size.
- The task is deleted while its draft and conversation exist → deletion behaves as
  feature 001 defined (one confirmation, then final); artifacts already filed at the
  destination are the user's files and are never touched by a deletion.
- Two tasks finished in quick succession to the same destination → both land,
  side by side, neither overwriting the other.
- The assistant switch is turned off with in-flight assistance steps → in-flight work is
  honestly reported (completed or failed), and nothing new is started while off.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST offer Document-family tasks in which the user writes
  content directly on the task — a working area presented alongside that task's
  background, target, and attachments.
- **FR-002**: The system MUST persist the user's written content as durable task
  material: it survives editing, task re-opening, and application restarts, and no
  finish step may destroy, replace, or clear it.
- **FR-003**: When a Document-Type task with written content is finished, the system
  MUST organize that content according to the Type's declared assistant instruction and
  file the result at the Type's declared destination, then complete the task and report
  where the filed copy went.
- **FR-004**: Filing MUST create a new file at the destination and MUST NEVER overwrite,
  move, or update a file that already exists there; a name collision produces a
  distinctly named new file beside it.
- **FR-005**: The organizing step MUST restructure, not reinvent: every fact and action
  item in the filed document MUST be traceable to the user's own written content. When
  that check fails, the system MUST file the user's content as written and report the
  assistant step as failed.
- **FR-006**: No finish may fail solely because assistance is unavailable or unhelpful:
  with the assistant off, unconfigured, or its step failed, the system MUST still file
  the user's own content as written, complete the task, and plainly report which step
  did not happen.
- **FR-007**: When a Type's declared destination is not usable at finish time (not
  configured, or the location no longer exists), the system MUST refuse the finish with
  a concrete, actionable reason and leave the task actionable — never complete it
  silently, never substitute a different location.
- **FR-008**: The system MUST let the user hold a conversation about a single task with
  the assistant at any time while working, grounded in that task's own material
  (background, target, declared inputs, and written content).
- **FR-009**: The system MUST keep each conversation with its task across restarts, MUST
  present it when the task is opened, and MUST let the user start a fresh conversation
  without losing the previous ones.
- **FR-010**: A conversation MUST never act on the board: it files nothing, completes
  nothing, and changes nothing outside itself.
- **FR-011**: An assistant action concerning a task MUST carry to the model service only
  that task's own material and the user's request; content belonging to other tasks MUST
  never be part of an outbound request.
- **FR-012**: Built-in and user-defined Types with the same declarations MUST behave
  identically; what a task's assistance does MUST be decided by its Type's declarations
  (family, declared inputs, assistant instruction, finish behaviour, destination) and by
  nothing else.
- **FR-013**: The system MUST let the user create, edit, and remove user-defined Types
  within the families this feature lights up, MUST refuse an incomplete destination
  declaration at save time with an actionable reason, and MUST handle removal of a Type
  in use without orphaning task content silently.
- **FR-014**: Editing a Type MUST change assistance from the next action onward and MUST
  never modify artifacts already filed.
- **FR-015**: [NEEDS CLARIFICATION: does this feature make per-Type grants live —
  letting a Type's assistance reach registered skills and/or tool servers (connectors) —
  or does every Document assistance run with no external reach, deferring grants to the
  first family that needs them?]
- **FR-016**: [NEEDS CLARIFICATION: this feature must decide the fate of the reference
  implementation's three assistance engines (the learning/ingest-to-wiki flow, the
  JIRA/Confluence working area, and meeting minutes) and the four seed Types — delete,
  re-argue under the new taxonomy, or leave dormant behind the assistant switch — as
  required by ADR-0001. What is the scope?]
- **FR-017**: While the assistant switch is off, the system MUST construct no assistant
  session and make no outbound call; the Document loop MUST still deliver FR-002 and
  FR-006 (write freely, finish files as written), so the board's promise that no flow
  requires AI holds for this feature's surfaces too.
- **FR-018**: The system MUST present every interface text this feature adds in both
  English and Simplified Chinese, switchable by the user's setting.
- **FR-019**: The system MUST deliver this feature equivalently on Linux and Windows
  desktops.
- **FR-020**: The system MUST keep everything the user writes in the application's data
  folder under feature 001's portability rule: copying that folder to a fresh setup
  brings the drafts and conversations with it (secrets re-entered on use, as before).

### Key Entities

- **Task** (extends feature 001): now also carries its Type (and through it its Family),
  and the user's written working-area content.
- **Type declaration**: a workflow configuration belonging to a Family — declared
  inputs, assistant instruction, finish behaviour, output destination, (grants, if live)
  — built-in or user-defined; the sole determinant of what assistance does.
- **Family**: one of the master specification's three classifications of assistance
  (Document, Working system, Coding); this feature concerns Document alone.
- **Working area**: the space on a task where the user writes the actual work; its
  content is the user's own, durably kept, never consumed by finishing.
- **Filed artifact**: the copy handed to the destination at finish — the organized
  document, or the user's words as written when organizing was unavailable or refused.
- **Destination**: the location a Type declares for its finished artifacts, owned by the
  user on their own machine.
- **Conversation**: a task-owned, continuing exchange with the assistant grounded in
  that task's material.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the assistant configured, a user goes from first keystroke of a draft
  to a filed artifact they can locate at their destination — with no other tool open —
  in under 3 minutes for a short piece.
- **SC-002**: With the assistant never configured (or the switch off), 100 % of the
  User Story 1 finish path still completes: the user's own words are filed as written,
  and no step dead-ends or reaches the network.
- **SC-003**: Across 10 varied finishing runs, reviewers find that every filed artifact
  either carries only content traceable to the user's draft or was filed un-organized
  with the assistant step visibly reported as failed — zero unnoticed fabrications.
- **SC-004**: A first-time user defines a working custom Document Type, finishes a task
  with it, and finds the artifact, in under 10 minutes without external documentation.
- **SC-005**: In spot checks of grounded conversations, at least 90 % of assistant
  replies reference the task's own written content (quotes or specific paraphrases a
  reviewer can verify) rather than generic advice.
- **SC-006**: Across application restarts, 100 % of drafts and conversation histories
  return intact and in order.
- **SC-007**: All acceptance scenarios pass unmodified on both Linux and Windows, in
  both interface languages.
- **SC-008**: After 30 days of ordinary use, a user can find any previously filed
  artifact at its destination (names and locations as declared), and no application
  action has modified or removed anything already filed.

## Assumptions

- **Terminology**: this spec uses the glossary in `CONTEXT.md` — Family, Type, Working
  area, Destination, Grant, Connector, Wiki. "Category" remains retired.
- **Starting state**: feature 001 shipped the board plus a configured-but-inert harness,
  and hid the reference implementation's assistant surfaces behind the
  assistant-runtime switch (off by default). This feature replaces inertness with the
  first live assistance, on the master specification's taxonomy; what it deletes,
  re-argues, or leaves of the reference flows is the subject of FR-016's open question.
- **Plain tasks remain**: tasks with no assistance (the reference "plain" behavior)
  continue to exist as a no-assistance Type; this feature does not make assistance
  mandatory for any task.
- **Writing surface form**: drafts are the user's plain written content; a richer
  working-area layout is the glossary's open design question and is out of scope for
  this feature's requirements.
- **Destinations are user-owned locations on the user's machine**: the application files
  documents; publishing to external systems (a Confluence page, a blog service) belongs
  to the Working system family and its connectors, not here.
- **Assistant output language**: the model's own; interface language never reaches a
  prompt (feature 001's standing rule).
- **Undo story**: filed artifacts are the user's files and are never edited or deleted
  by the application afterwards; the destination itself is where their history lives.
  (The reference implementation's snapshot-based undo is part of what FR-016 decides.)
- **Dependency**: the configured model service from feature 001 (verify on demand,
  honest readiness states, secrets kept private to the machine account) is the only
  external service this feature's first iteration needs; skills and tool servers remain
  registered-but-inert unless FR-015's grant question answers "live".
- **Platforms, bilingual UI, data-folder portability**: standing product commitments
  carried from feature 001 (its FR-017/018/021), restated here as FR-018/019/020.
