# Feature Specification: Document Type AI Assistant

**Feature Branch**: `feature/002-document-assist`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: `let's trigger the 002 feature spec` — the v1.0 milestone's *Document type AI assistant* row of `docs/specification/Specification.md`, assigned to feature 002 by the milestone mapping in ADR-0001. Feature 001 delivered the board and an inert, configured harness; this feature lights the first assistance family: **Document** — writing done in the application, organized by the assistant, kept in user-owned knowledge, and question-able at any time.

## Clarifications

### Session 2026-10-10

- Q: How far does this feature take the master specification's "save into the path with LLM-wiki support" promise, and what happens to the three reference-implementation engines? → A: **Faithful** — the knowledge base (LLM-wiki) destination is re-argued in full: deposit-first durability, curation confined to the declared collection, undo against retained history; the learning case is delivered by knowledge-base-destined Document Types; the JIRA/Confluence and meeting-minutes engines are retired from the product with all user data preserved — ADR-0001's review-and-delete mandate discharged here (FR-016–FR-020).
- Q: Do per-Type grants become live in this feature? → A: **No** — every Document-family assistance (organizing, conversing, curating) runs confined; registered skills and tool servers stay inert for it; per-Type grants arrive with the first family that needs external reach (FR-015).
- Q: Which built-in Document Types ship? → A: **One** generic write-and-file Document Type; every further Document workflow — the learning-note case included — is realized as a user-declared Type on the same machinery (FR-001, FR-013).

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

### User Story 4 - Finished work curates my knowledge base (Priority: P4)

The master specification's Document row does not stop at a filed file: when a Document
Type declares the user's **knowledge base** — a personal collection of documents kept
following the LLM-wiki pattern — as its destination, finishing a task feeds it in two
ordered steps. The user's own material is deposited first, durably; nothing that comes
after can lose it. Then the assistant curates: it integrates the new material into the
knowledge base as that collection's own established rules describe — its index, its
pages — writing nowhere else. If the assistant cannot curate, the deposit already
stands and the finish completes with the curation step plainly reported as failed. If
the user dislikes a curation that did run, one undo returns the knowledge base to the
state kept for it. The master spec's learning-note case — original material, raw
thoughts, well-kept notes, questions answered from that context — is this story working
under a user-declared Type (the seeded set carries only the generic one, per the Q3
answer).

**Why this priority**: This is the row's "save into the path with LLM-wiki support"
promise — kept in full here by Q1's answer — but it extends US1's filing loop with the
declarations US3's Type machinery already provides, so its value lands after those.

**Independent Test**: Declare a knowledge-base-destined Document Type, finish a drafted
task into it, and verify: the deposited material exists, the curated changes appear
only inside the collection, the report says what changed, and undo returns the prior
state. Then switch the assistant off and finish another task: the deposit alone lands,
the task completes, and the failed step is stated.

**Acceptance Scenarios**:

1. **Given** a Document Type destined to the knowledge base, **When** a task with
   written content is finished, **Then** the user's material is deposited in the
   knowledge base first and durably, before the curation has any say.
2. **Given** the assistant off, unconfigured, or its curation failing, **When** such a
   finish runs, **Then** the deposit stands, the task completes, and the app reports
   that curation did not happen.
3. **Given** a curation that ran, **When** the user undoes it, **Then** the knowledge
   base returns to the state kept before that curation.
4. **Given** any curation, **When** its changes are listed, **Then** every one lies
   inside the declared knowledge base and nothing outside it changed.

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
- A knowledge-base location is deleted or unmounted before a destined finish → the
  finish is refused while the task stays actionable (FR-007's rule, unchanged); a
  location's re-appearance never silently resurrects half-a-finish.
- Two curations land on the same page → each keeps its own retained prior state;
  undoing returns the most recent kept state, and the app says which state it restores.
- The user edits the knowledge base by hand after a curation → the next curation works
  from the collection as it stands; the application never assumes its last word — the
  knowledge base belongs to the user.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST offer Document-family tasks in which the user writes
  content directly on the task — a working area presented alongside that task's
  background, target, and attachments — through exactly one built-in generic
  write-and-file Document Type; every further Document workflow is a user-declared
  Type (FR-013).
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
- **FR-015**: The system MUST run every Document-family assistance — organizing,
  conversing, and curating alike — confined: it MUST NOT load any registered skill and
  MUST NOT contact any tool server (connector), and no Type declaration may confer such
  reach. Per-Type grants are out of scope for this feature, arriving with the first
  family that needs external reach.
- **FR-016**: The system MUST run assistance only under this specification's taxonomy
  (Family and declared Type). The reference implementation's assistance engines — the
  learning intake flow, the JIRA/Confluence working area, and meeting minutes — MUST NOT
  persist as parallel flows: the learning and knowledge-base case is delivered by
  Document Types destined to the knowledge base (FR-018–FR-020); the working-system and
  minutes cases are removed, returning — if at all — with their own future features.
  ADR-0001's review-and-delete mandate is discharged by this feature.
- **FR-017**: Retiring those engines MUST NOT remove user data: material written on
  existing tasks under them stays on the board, readable and editable, and artifacts
  already filed stay where they were filed.
- **FR-018**: A Type MUST be able to declare the user's knowledge base (the LLM-wiki
  pattern collection) as its destination. When a task of such a Type with written
  content is finished, the system MUST deposit that material into the knowledge base
  durably first — before, and independently of the fate of, any curation step.
- **FR-019**: The curation step MUST write only inside the declared knowledge base and
  MUST follow that knowledge base's own established rules; it MUST report what it
  changed. When curation cannot run (assistant off, unconfigured, or failed), the
  deposited material stands, the task completes, and curation is reported as failed.
- **FR-020**: The system MUST retain the state a knowledge base held before each
  curation, for as many states as its kept history holds, and MUST let the user undo a
  curation back to a retained state.
- **FR-021**: While the assistant switch is off, the system MUST construct no assistant
  session and make no outbound call; the Document loop MUST still deliver FR-002
  (durable writing), FR-006 (finish files as written), and FR-018 (deposit first), so
  the board's promise that no flow requires AI holds for this feature's surfaces too.
- **FR-022**: The system MUST present every interface text this feature adds in both
  English and Simplified Chinese, switchable by the user's setting.
- **FR-023**: The system MUST deliver this feature equivalently on Linux and Windows
  desktops.
- **FR-024**: The system MUST keep everything the user writes — drafts and conversations
  — inside the application's data folder under feature 001's portability rule (copying
  the folder carries the board; secrets are re-entered on use). Declared destinations,
  including knowledge bases, live where the user pointed them and travel by the user's
  own hand.

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
- **Knowledge base (Wiki)**: a user-owned collection of documents kept following the
  LLM-wiki pattern, which a Document Type may name as its destination; it takes
  deposits, receives curations, holds retained states for undo, and belongs to the user.
- **Deposit**: the user's own material handed to a knowledge base at finish, before and
  above the fate of the curation step.
- **Curation**: the assistant's integration of a deposit into a knowledge base,
  confined to that collection and reversible against retained history.

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
- **SC-009**: Across deliberately induced curation failures (assistant off, unconfigured,
  error mid-curation), 100 % of runs leave the user's deposited material intact in the
  knowledge base with the task completed; and every completed curation the users tried
  to undo returned the collection to the state named, 0 undo failures.
- **SC-010**: A first-time user reproduces the master specification's learning case —
  declare a knowledge-base-destined Type, record material, write thoughts, finish, find
  the curated result, ask about it — in under 15 minutes without external documentation.

## Assumptions

- **Terminology**: this spec uses the glossary in `CONTEXT.md` — Family, Type, Working
  area, Destination, Grant, Connector, Wiki. "Category" remains retired.
- **Starting state**: feature 001 shipped the board plus a configured-but-inert harness,
  and hid the reference implementation's assistant surfaces behind the
  assistant-runtime switch (off by default). This feature replaces inertness with the
  first live assistance, on the master specification's taxonomy, and discharges
  ADR-0001's review duty: the knowledge-base flow is re-argued and carried forward as
  the behavior of knowledge-base-destined Document Types; the JIRA/Confluence and
  meeting engines are retired with user data preserved (FR-016, FR-017).
- **Plain tasks remain**: tasks with no assistance (the reference "plain" behavior)
  continue to exist as a no-assistance Type; this feature does not make assistance
  mandatory for any task.
- **Writing surface form**: drafts are the user's plain written content; a richer
  working-area layout is the glossary's open design question and is out of scope for
  this feature's requirements.
- **Destinations are user-owned locations on the user's machine**: the application files
  documents; publishing to external systems (a Confluence page, a blog service) belongs
  to the Working system family and its connectors, not here — and with Q2's confined
  answer, external reach is doubly out of scope: nothing in this feature may use it
  even if configured (FR-015).
- **Assistant output language**: the model's own; interface language never reaches a
  prompt (feature 001's standing rule).
- **Undo story**: filed artifacts at plain destinations are the user's files and are
  never edited or deleted by the application afterwards. Inside a knowledge base the
  rule is deliberately the other way, because the master spec asks for it: the
  application curates there, so it keeps the history that makes each curation undoable
  (FR-020).
- **Dependency**: the configured model service from feature 001 (verify on demand,
  honest readiness states, secrets kept private to the machine account) is the only
  external service this feature uses; skills and tool servers stay registered-but-inert
  (FR-015) until grants arrive with a later family.
- **Seed-set synthesis**: Q1 brings the learning/wiki workflow into this feature as
  machinery; Q3 keeps the seeded rows minimal — exactly one generic Document Type.
  The learning case is therefore reproducible by a user-declared Type on this
  feature's machinery (SC-010 tests that path), not shipped as its own built-in row.
- **Platforms, bilingual UI, data-folder portability**: standing product commitments
  carried from feature 001 (its FR-017/018/021), restated here as FR-022/FR-023/FR-024.
