# Feature Specification: Extensible Type Workflows

**Feature Branch**: `001-extensible-type-workflows`

**Created**: 2026-09-11

**Status**: Partially implemented — see the implementation note below.

> **Implementation note (2026-09-12).** Delivered: the Meeting type end to end
> (pre-process to agenda and core topics, markdown minutes, polish-then-file into a
> configured folder); per-type output destinations, user-editable and confined; the four
> declared finish behaviours replacing the category branch, with the Learning flow
> re-expressed as `deposit-then-curate` and behaving identically; user-defined types
> declaring their own prompt, destination and behaviour; and the grant machinery —
> per-type grants, confinement by construction, the egress boundary, and
> propose-then-confirm. **Deferred**: the tool-server *transport* (FR-018, amended
> above) — the grant seam and every rule around it ship and are tested against a
> scripted tool double, but a granted tool server does not yet reach its external
> system. `research.md` R7a records the gate evidence for that decision.

**Input**: User description: "A daily task management application similar to MS To Do but with AI features. 'To Do' and 'My Day' lists, a 3-column UI (categories | task list | working area split into AI pre-processing on top and human working area below). A **Type** mechanism: every task carries a type, and the type defines the AI pre-processing and the human working area. Learning type (AI analyses material and suggests; human records notes saved into a configured LLM-wiki space). Meeting type (AI suggests agenda and core topics; human records minutes which are re-organized, polished, and saved to the configured meeting-minutes system). JIRA type (AI summarises status and suggests next steps; human can change status, leave comments, chat with AI). Support Skill, MCP and other AI agent tools easily so users can extend capabilities themselves. Users can customise types for their own requirements. An MVP implementation already exists, so the constitution and current implementation were analysed for proceeding."

## Clarifications

### Session 2026-09-11

- Q: When a task type has been granted an external tool server, what content is allowed to leave the machine as part of that session's work? → A: Only the task's declared inputs and the content of the user's request. Notes, minutes, drafts, the note store, the wiki, and other tasks are never transmitted.
- Q: Before a remote change is made to an external system, what must the user have done for that change to count as "explicitly requested"? → A: The user must confirm that specific change immediately before it executes. The assistant may prepare a remote change, but no change ever executes without a per-change confirmation, regardless of how it was requested.
- Q: What is the closed set of finish behaviours that a type can offer the user to choose from? → A: A fixed set of four — complete only, file as-is, polish then file, and deposit then curate.
- Q: How far may "polish" go in rewriting the minutes the user wrote? → A: Polish may restructure and tighten the prose, but must preserve every fact, decision, and action item the user recorded and must not introduce content the user did not write. It must also present the recorded action items as a distinct section of the finished document.
- Q: When a finish would produce an artifact at a location where one already exists, how should the existing file be preserved? → A: Nothing is ever overwritten or moved. The new artifact is written under a distinct name alongside the existing one, so the destination holds every version as an ordinary file the user manages.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Meeting tasks from agenda to filed minutes (Priority: P1)

A user has a meeting to prepare for and attend. They create a task with the Meeting type, fill in what the meeting is about and any supporting material, and add it to My Day. The assistant analyses the material and proposes an agenda and the core topics worth covering. During or after the meeting the user writes their minutes in the task's working area, which saves as they type. When they Finish the task, the minutes are re-organized and polished, and the finished document is written to their configured meeting-minutes folder as a plain markdown file they own and can read in any editor.

**Why this priority**: This is the headline capability. It delivers a complete new end-to-end workflow — a new task type, its pre-processing, its working area, and its finish destination — and it is the first workflow whose finished artifact does not belong in the wiki. Delivering only this story already gives the user a genuinely new way to work.

**Independent Test**: Create a meeting task, add it to My Day, run pre-processing, confirm an agenda and core topics are proposed, write minutes, Finish, and verify that a polished markdown file exists at the configured meeting-minutes location and that the task is marked complete. Fully testable without any other story.

**Acceptance Scenarios**:

1. **Given** a task of the Meeting type in My Day with its required details filled in, **When** pre-processing runs, **Then** the user is shown a suggested agenda and a set of core topics derived from the task's own content.
2. **Given** a Meeting task whose pre-processing has completed, **When** the user opens the task, **Then** the working area offers an editing surface where minutes can be written and which preserves edits without an explicit save action.
3. **Given** a Meeting task with minutes written that record actions the user noted, **When** the user Finishes the task, **Then** the system re-organizes and polishes the minutes, presents the recorded actions as a distinct action-items section, writes the result as a plain markdown file into the configured meeting-minutes location, and marks the task complete.
4. **Given** a Meeting task that has been finished, **When** the user inspects the meeting-minutes location, **Then** the file is readable as plain markdown and requires no wiki workspace, schema, or indexing to be understood.
5. **Given** no AI provider is configured, **When** the user Finishes a Meeting task, **Then** the task still completes and the minutes are saved in a retrievable form rather than being lost or blocking completion.
6. **Given** a Meeting task whose minutes the user wrote, **When** the task is finished, **Then** the finished document contains no fact, decision, or action item that the user did not record.

---

### User Story 2 - Choosing where a type's finished work goes (Priority: P2)

A user wants control over where their finished artifacts land. In Settings they inspect their task types and see, for each one, the location its finished work is written to. They change the meeting-minutes location to a folder inside their existing notes area, and change a learning type's note location. Subsequent Finishes honour the new locations, while artifacts already saved stay exactly where they are.

**Why this priority**: This makes the destination a first-class, user-owned setting rather than something fixed for the whole application, and it is what allows new types to exist at all. It is separable from P1: the mechanism can be inspected and adjusted on its own, and it is the prerequisite the other stories build on.

**Independent Test**: Change a type's destination in Settings, Finish a task of that type, and verify the artifact lands in the new location. Verify that artifacts saved before the change are still in their original location and unchanged.

**Acceptance Scenarios**:

1. **Given** the Settings surface, **When** the user views a task type, **Then** the location that type's finished artifacts are written to is shown.
2. **Given** a type whose destination the user has changed, **When** a task of that type is finished, **Then** the artifact is written to the new location.
3. **Given** a type whose destination the user has changed, **When** the user inspects artifacts saved before the change, **Then** those artifacts remain in their original location, unmodified.
4. **Given** the existing Learning type, **When** a learning task is finished, **Then** its behaviour is unchanged from before this feature: the material is deposited into the wiki and the curated note is still written at the learning-note path.

---

### User Story 3 - Users define their own types (Priority: P3)

A user has a recurring kind of work the built-in types do not cover. They create a new type in Settings: they name it and give it an icon, write the instruction the assistant should follow when pre-processing tasks of this type, state where the finished artifact should be written, and choose how Finish should behave. They then create tasks of that type and the whole workflow — pre-processing, working area, and Finish — follows their definition, with no code changes.

**Why this priority**: This is what turns the type engine from something the product team controls into something the user controls, which is the difference between a fixed set of workflows and an extensible tool. It depends on P2 for destinations, so it is not first, but it is independent of P1 and P4.

**Independent Test**: Define a custom type with its own prompt, destination, and finish behaviour entirely from Settings, create a task of it, and verify pre-processing uses the custom prompt and Finish routes to the declared destination — all without code changes.

**Acceptance Scenarios**:

1. **Given** the type settings surface, **When** the user creates a type, **Then** they can provide a label, an icon, an AI instruction, an output destination, and a choice of finish behaviour.
2. **Given** a custom type with its own AI instruction, **When** pre-processing runs on a task of that type, **Then** the instruction is reflected in the analysis and suggestions produced.
3. **Given** a custom type with its own destination and finish behaviour, **When** a task of that type is finished, **Then** the artifact is produced and written according to that type's declarations.
4. **Given** a custom type that tasks reference, **When** the user deletes the type, **Then** the tasks themselves and any artifacts already saved are not destroyed.
5. **Given** a built-in type, **When** the user attempts to change its behaviour category, **Then** the change is refused while its presentation details remain editable.

---

### User Story 4 - Extending the assistant with skills and connectors (Priority: P4)

A user has registered skills and external tool servers in Settings. They grant a specific one to their JIRA type. Now when they work a JIRA task, the assistant can actually look at the referenced issue and report its real status, and — only after the user asks and then confirms that specific change — change that status or post a comment. Meanwhile the assistant's confined background jobs remain confined: nothing that merely ingests or polishes their notes gains the ability to reach outside.

**Why this priority**: It converts configuration that today does nothing into real capability, and it is what makes the JIRA workflow's promised remote actions possible. It is last because it is the largest and highest-risk change: it deliberately opens agent sessions to external tools, so it must build on the per-type declaration work in P2 and P3.

**Independent Test**: With a stand-in external tool server, verify that a session for a type that has been granted the server can use it, that a session for a type without the grant cannot, and that a confined background job cannot use it even when the type has been granted it.

**Acceptance Scenarios**:

1. **Given** skills and tool servers registered in Settings, **When** the user views a task type, **Then** they can grant specific registered entries to that type.
2. **Given** a JIRA task whose type has a tool server granted, **When** the user requests current information about the referenced issue, **Then** the assistant reports the actual status read from the source rather than only the content pasted into the task.
3. **Given** a JIRA task with remote actions available, **When** the user asks to change the issue status or post a comment, **Then** the change is prepared and performed only after the user confirms that specific change, and its outcome is reported back.
4. **Given** any task, **When** the user performs no explicit action requesting a remote operation, **Then** no remote change is made.
5. **Given** a type that has been granted external tools, **When** a confined background job runs for a task of that type, **Then** the confined job does not receive the granted tools.

---

### Edge Cases

- What happens when the configured destination folder does not exist, or the user no longer has permission to write to it?
- What happens when a destination path is set to a location outside the intended destination root, or contains traversal segments that would escape it?
- What happens when two finished tasks would produce the same artifact filename in the same destination? (Resolved by FR-026: the second is written under a distinct name alongside the first; nothing is overwritten or moved.)
- What happens when polishing fails partway through, produces empty output, or produces clearly unusable output?
- What happens when the assistant is unavailable, misconfigured, or the model call fails during Finish — is the user's written work still preserved?
- What happens when a user changes a type's destination while a task of that type has already been started but not finished?
- What happens when a user deletes or renames a custom type while tasks of that type are still open?
- What happens when minutes are far larger than the assistant can process in one go?
- What happens when a granted tool server is unreachable, returns an error, or is removed from Settings after being granted?
- What happens when a granted tool attempts an operation the user did not ask for, or attempts to act outside the scope granted to that type?
- What happens to tasks of a built-in type if a user removes a field that type declares?
- What happens when the user finishes a task twice, or finishes an already-completed task?

## Requirements *(mandatory)*

### Functional Requirements

**Task types and destinations**

- **FR-001**: The system MUST provide a built-in Meeting task type alongside the existing types.
- **FR-002**: Each task type MUST declare the destination its finished artifact is written to, instead of one destination being fixed for all types.
- **FR-003**: The system MUST preserve the existing Learning behaviour exactly: on Finish, source material is deposited first and the curated note is written at the learning-note path (the "deposit then curate" behaviour of FR-014).
- **FR-004**: Users MUST be able to view and change the destination for a task type.
- **FR-005**: A destination change MUST apply to subsequent finishes only; artifacts already saved MUST NOT be moved, rewritten, or deleted.
- **FR-006**: The system MUST refuse a destination that resolves outside the permitted destination root rather than writing to an unintended location.

**Meeting type behaviour**

- **FR-007**: Pre-processing a Meeting task MUST propose a suggested agenda and core topics derived from the task's own declared inputs and content.
- **FR-008**: The Meeting working area MUST provide a formatted editing surface for minutes that preserves the user's writing without requiring an explicit save action.
- **FR-009**: On Finish of a Meeting task, the system MUST re-organize and polish the minutes before saving them (the "polish then file" behaviour of FR-014). Polishing MUST preserve every fact, decision, and action item the user recorded, MUST NOT introduce any content the user did not write, and MUST present the action items the user recorded as a distinct section of the finished document.
- **FR-010**: The finished minutes MUST be saved as a plain markdown file that is readable without any wiki workspace, schema, indexing, or cataloguing.
- **FR-011**: The user's written minutes MUST be preserved in a retrievable form even when polishing is unavailable or fails.

**User-defined types**

- **FR-012**: Users MUST be able to create a task type that declares its own AI instruction used during pre-processing.
- **FR-013**: Users MUST be able to create a task type that declares its own output destination for finished artifacts.
- **FR-014**: Users MUST be able to create a task type that declares its own finish behaviour, selected from a fixed set of four: **complete only** (writes nothing), **file as-is** (saves the working content unchanged to the destination), **polish then file** (the assistant rewrites the content, then it is saved), and **deposit then curate** (the raw material is preserved first, then the assistant authors the artifact).
- **FR-015**: Users MUST be able to edit and delete the types they created.
- **FR-016**: Deleting a type MUST NOT destroy tasks or artifacts already saved; affected tasks MUST be reassigned rather than lost.
- **FR-017**: The system MUST refuse a change to a built-in type's behaviour category while still allowing its presentation details to be edited.

**Skills, connectors, and agent tooling**

- **FR-018** *(amended — see the note below)*: Skills registered in Settings MUST become usable as tools by assistant sessions, rather than only being stored and displayed. External **tool servers** MUST be grantable, and every confinement, egress and confirmation rule that governs their use (FR-019 to FR-024, FR-029) MUST hold; the **transport** that connects a granted tool server to an assistant session is deferred to a follow-up specification, so a granted tool server does not yet reach its external system.

  > **Amendment, 2026-09-12.** The transport was to be adopted from the community package
  > `pi-mcp-adapter`, pinned to an exact version, subject to verification gates
  > (`research.md` R7). Gate T061 failed on its own stated criterion: the package's
  > dependencies pin `@modelcontextprotocol/client` and `@modelcontextprotocol/core` to
  > `pkg.pr.new` **preview commit URLs** rather than published npm versions — ephemeral,
  > outside npm's provenance pipeline, and for packages that do have ordinary releases.
  > The gates for both-platform native builds (T062), the terminal-UI peer (T063) and
  > credential containment (T064) could not be completed either. `research.md` R7a records
  > the full evidence and the decision. The grant seam, the confinement guarantee (SC-006),
  > the egress boundary (SC-010) and the propose-then-confirm model (SC-005) all ship and
  > are tested against a scripted tool double; only the live external connection is deferred.
  > This requirement is amended rather than left claiming behaviour that is not built.
- **FR-019**: Tool availability MUST be granted per task type, so a type receives only the entries granted to it.
- **FR-020**: Confined background operations — material ingestion, minute polishing, and suggestion generation — MUST NOT receive externally granted tools under any configuration.
- **FR-021** *(amended — see the note below)*: For a type granted a tool server, the assistant MUST be able to read current information about the referenced external item rather than relying solely on content pasted into the task. The **grant resolution and the instruction** that stops telling a granted session it has no access MUST hold; the **read itself** depends on the tool-server transport deferred under FR-018, so a granted session does not yet fetch anything.

  > **Amendment, 2026-09-12.** The FR-018 amendment defers the tool-server transport, and this requirement cannot be honoured without it. Rather than leave a second requirement claiming capability the application does not have, it is marked here as dependent on the same deferral (`research.md` R7a). What ships today: a granted type resolves to a real grant at the session-build seam, and its pre-process instruction no longer asserts "no access to the remote system" — it is told to prefer a live source when it has one. What does not ship: the connection that would let it look.
- **FR-022** *(amended — see the note below)*: The assistant MUST be able to prepare a remote change (such as a status change or a comment) when the user requests one, and MUST report the outcome once it is performed. The **preparation and the per-change confirmation** MUST hold; **performing** the change depends on the tool-server transport deferred under FR-018.

  > **Amendment, 2026-09-12.** As with FR-021, the transport this depends on is deferred (FR-018, `research.md` R7a). What ships today is the whole safety model around the change: the assistant proposes, the proposal carries the literal payload for the user to inspect, nothing is sent without a per-change confirmation, a confirmation applies exactly one change and cannot be replayed, and the mutating operation is unreachable from the model's tool surface. What does not ship is the call that would reach the external system — confirming currently reports that no transport is connected, rather than reporting success. That reporting is itself FR-024 satisfied.
- **FR-023**: Every individual remote change MUST be confirmed by the user immediately before it executes, regardless of how it was requested. A request made in conversation MUST NOT by itself cause a remote change.
- **FR-024**: When a granted tool server is unavailable or a remote operation fails, the failure MUST be reported to the user and MUST NOT be silently presented as success.

**Safety and reliability**

- **FR-025**: Finishing a task MUST complete successfully even when no AI provider is configured; only the AI-dependent portions may be skipped.
- **FR-026**: The system MUST NOT overwrite or relocate an existing artifact. When a finish would produce an artifact where one already exists, the new artifact MUST be written under a distinct name alongside it, so the destination holds every version as an ordinary file.
- **FR-027**: A finish that fails MUST leave the user's work intact and MUST be retriable without retyping it.
- **FR-028**: Failures and their outcomes MUST be visible to the user in the activity record, consistent with how background work is already reported.
- **FR-029**: When a granted tool server is used, only the task's declared inputs and the content of the user's request MAY be transmitted externally. The user's working content — notes, minutes, drafts — as well as the note store, the wiki, and other tasks MUST NOT be transmitted.

### Key Entities

- **Task Type**: A workflow template. Carries a display identity (label, icon, description), a behaviour category that determines its pre-processing and working area, a declared finish behaviour (one of the four in FR-014), a declared set of input fields, an AI instruction, an output destination, and whether it is built-in or user-created.
- **Task**: A unit of work. Carries its assigned type, values for that type's declared inputs, its My Day membership, its completion state, and any scheduled reminder. Its behaviour is determined by its type, never by hardcoded branching on a specific type name.
- **Output Destination**: The configured location a type's finished artifacts are written to. Owned by the type, editable by the user, and constrained to a permitted root.
- **Finished Artifact**: The document produced when a task is finished — a curated learning note or polished meeting minutes. Has a location, a pre-finish form, and any earlier versions, which coexist alongside it as separate files rather than replacing one another.
- **Plugin Grant**: The association between a task type and the specific skills or tool servers its assistant sessions may use. Absent for confined background operations by construction.
- **Skill**: A user-imported capability entry — from a local folder or a GitHub repository URL — that the assistant can be granted.
- **Tool Server**: A registered external system whose capabilities the assistant can be granted access to, so it can read current information from and act upon that system on the user's behalf.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from creating a meeting task to having polished minutes in their configured folder without ever opening a chat surface as the primary means of working.
- **SC-002**: The set of built-in task types grows from three to four, and no existing task changes its behaviour as a result.
- **SC-003**: Every previously supported Learning flow continues to behave identically — verified by the existing learning workflow tests continuing to pass unmodified.
- **SC-004**: A user can define a brand-new type with its own instruction, destination, and finish behaviour entirely from the settings surface, with zero code changes required.
- **SC-005**: Zero remote changes occur without a per-change user confirmation, verifiable by inspecting that no remote operation is reachable without that confirmation having been given.
- **SC-006**: Zero confined background operations receive externally granted tools, under every configuration a user can produce.
- **SC-007**: Finishing a task never fails solely because AI is unconfigured or unavailable — 100% of finishes complete and leave a retrievable artifact.
- **SC-008**: No user-authored content is lost or displaced: every finish that reports success leaves a retrievable artifact, and no existing artifact is ever overwritten or moved.
- **SC-009**: A user can add a new task type and use it in a real task within five minutes of opening the type settings, without documentation.
- **SC-010**: No content beyond a task's declared inputs and the user's explicit request is ever transmitted to an external tool server, under every configuration a user can produce.
- **SC-011**: No finished minutes contain a fact, decision, or action item the user did not record, verifiable by comparing the finished document against the user's written minutes.

## Assumptions

**Existing implementation (baseline)**

This specification describes the delta from an existing MVP. The following are already implemented and are therefore not requirements of this feature: the To Do and My Day lists with daily rollover; the three-column layout with the AI band above and the working area below; the type engine with three built-in behaviour categories and a type registry; the Learning type end to end including pre-processing and wiki ingestion on Finish; per-category working areas with task-grounded chat; task reminders; the activity ledger; the settings surface for types, skills, and tool servers; and AI provider configuration. This feature extends that baseline rather than replacing it.

**Scope boundaries**

- A type's working area continues to be determined by its behaviour category. Per-type working-area declaration is explicitly out of scope for this version, because its feasibility is not yet established. Custom types therefore choose a behaviour category and inherit its working area.
- Custom types can declare a destination, a finish behaviour, and an AI instruction, but cannot define input fields beyond those their behaviour category already declares.
- The first column of the interface continues to show only My Day and To Do. User-created list categories are out of scope for this version.
- The meeting-minutes destination is a plain markdown file in a configured folder. Publishing minutes to an external system (such as a wiki or corporate content platform) is out of scope for this version and is the intended later evolution.
- Tool servers are limited to the connection form the settings surface already supports. Additional forms are out of scope. Throughout this specification, "skill" and "tool server" refer to the two entry kinds the settings surface already lets users register (the latter being MCP servers in the product's own wording).

**Behavioural assumptions**

- The default meeting-minutes destination is a folder under the user's documents, and is user-configurable. (The wiki location has no such default: it is declared per type and refused at Finish when unset.)
- Polishing uses the user's configured AI provider. With no provider configured, minutes are saved in their written form, unpolished.
- The set of finish behaviours is fixed at the four named in FR-014; users select among them rather than defining new ones. Composing custom step sequences, and finish behaviours that act on an external system, are out of scope for this version.
- Reading current external information and performing remote changes both require a tool server granted to the type; absent a grant, the assistant continues to work only from content the user pasted in, exactly as today.
- Existing skills and tool server configuration remains valid and is not migrated or invalidated by this feature.
- The existing confinement guarantee — that background jobs never reach external tools — is a property to be strengthened and preserved, not relaxed.
