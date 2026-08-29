# Delta Spec: wiki-ingest

## Purpose

Connects finished learning work to the user's personal knowledge base: the app automatically creates and maintains an LLM-WiKi directory structure, and ingests finished reading notes in the background (via the embedded agent) without any user-visible wiki operation — transparency is provided by an in-app activity log only.

## ADDED Requirements

### Requirement: Learning space location setting
The system SHALL let the user configure the directory of their learning space in settings, with a sensible default under the user's documents. The app SHALL accept an empty/nonexistent directory and create the structure on demand.

#### Scenario: Default location
- **WHEN** the user finishes their first paper task without configuring a location
- **THEN** the learning space is created at the default location and ingestion proceeds

#### Scenario: Custom location
- **WHEN** the user sets a custom directory in settings before finishing a task
- **THEN** the learning space is created and maintained in that directory

### Requirement: Automatic wiki scaffolding
On first ingestion (or first configured use), the app SHALL automatically create the LLM-WiKi structure in the learning-space directory: raw source area, wiki pages area, an index page, an append-only activity log file, and a schema/instructions file that defines page conventions and the ingestion workflow for the embedded agent. The app owns and maintains this schema; the user is never asked to author it in v1.

#### Scenario: First finish scaffolds the wiki
- **WHEN** the user finishes a paper task with no existing learning space
- **THEN** the complete wiki structure is created automatically before ingestion begins

#### Scenario: Existing structure reused
- **WHEN** a learning space already exists at the configured location
- **THEN** the app reuses it and MUST NOT overwrite or reset the existing schema, index, or pages

### Requirement: Invisible ingestion UX
Ingestion SHALL require no user interaction: after Finish, the UI shows only a lightweight confirmation (e.g., a toast or status line), and wiki operations happen entirely in the background. The app MUST NOT open, require, or interrupt the user with wiki editor screens, plan approvals, or diff views in v1.

#### Scenario: No friction on finish
- **WHEN** ingestion is running after Finish
- **THEN** the user can continue using the app normally and is not presented with any wiki-operation dialogs

### Requirement: Ingestion behavior
For each finished paper task, the system SHALL deposit the reading note, the generated analysis summary, and (when available) the paper PDF into the wiki's raw source area, then run an embedded agent that updates the wiki: writes a source summary page, updates the index, updates related concept/entity pages where applicable, and appends an entry to the activity log. The agent MUST follow the schema file's conventions.

#### Scenario: Full ingestion of a finished paper
- **WHEN** ingestion completes for a finished paper task
- **THEN** the raw area contains the note (and summary/PDF where available), the wiki contains a summary page linked from the index, and the activity log has a new entry

### Requirement: Safety history without git
The system SHALL record, before each ingestion, the prior content of every wiki file the ingestion modifies, in a history file inside the learning space, so that a bad ingestion can be manually undone without requiring git.

#### Scenario: Ingestion is undoable
- **WHEN** an ingestion modifies existing wiki pages
- **THEN** the previous contents of those pages are preserved in the history file before the change

### Requirement: Activity log surfacing
The app SHALL expose an in-app "activity" view listing past ingestion operations (what was ingested, when, and which files were touched). This is the only user-visible trace of wiki operations in v1.

#### Scenario: View activity
- **WHEN** the user opens the activity view after several finished papers
- **THEN** each ingestion is listed with its task, timestamp, and touched files

### Requirement: Failure handling
Ingestion failure (provider error, agent error, inaccessible directory) SHALL NOT affect the completed task or the user's note: the deposit SHALL be attempted first so the source material is always present, failures SHALL be retried automatically, and persistently failed ingestions SHALL be surfaced in the activity view with a retry affordance.

#### Scenario: Deposit survives agent failure
- **WHEN** the ingestion agent fails after the deposit step
- **THEN** the note and summary already exist in the raw area, the task remains completed, and the activity view shows a retryable failed ingestion

#### Scenario: Retry succeeds later
- **WHEN** the user retries a previously failed ingestion after fixing the cause (e.g., valid API key)
- **THEN** ingestion completes normally and the activity view reflects success
