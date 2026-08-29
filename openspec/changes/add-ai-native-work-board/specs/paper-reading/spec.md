# Delta Spec: paper-reading

## Purpose

Implements the flagship task enrichment: a paper-reading task that is analyzed in the background when moved to My Day, presents a summary plus reading suggestions in its detail panel, provides a markdown reading-notes area, and hands the finished note to the learning-space ingestion flow on "Finish".

## ADDED Requirements

### Requirement: Creating a paper-reading task
The system SHALL let the user create a task of type "paper reading" by providing the paper's full name and a link (URL). Both fields SHALL be required. The task SHALL behave as a normal task in lists and My Day.

#### Scenario: Create paper task
- **WHEN** the user creates a paper-reading task with a title and a link
- **THEN** the task appears in the chosen list like any other task

#### Scenario: Missing link rejected
- **WHEN** the user tries to create a paper-reading task without a link
- **THEN** creation is blocked with a clear message

### Requirement: Analysis triggers on My Day
When a paper-reading task is added to My Day, the system SHALL automatically start a background analysis job. A task already analyzed SHALL NOT be re-analyzed on subsequent My Day additions unless the user explicitly requests re-analysis.

#### Scenario: Move triggers analysis
- **WHEN** the user adds a paper-reading task to My Day
- **THEN** an analysis job starts without further user action

#### Scenario: No re-analysis
- **WHEN** the user removes and re-adds an already-analyzed paper task to My Day
- **THEN** the existing analysis is shown and no new job runs

### Requirement: Link resolution and paper fetching
The system SHALL resolve the provided link to paper metadata and, where openly available, the full text. arXiv links SHALL be fully supported. For DOI or publisher links, the system SHALL at minimum extract metadata and abstract, and SHALL fetch the full text only when openly accessible. The system SHALL always record which level was achieved.

#### Scenario: arXiv paper fully analyzed
- **WHEN** the user provides an arXiv link
- **THEN** the analysis is based on the paper's full text

#### Scenario: Paywalled paper
- **WHEN** the provided link does not give open access to the full text
- **THEN** the analysis proceeds using metadata and abstract, and the detail panel clearly indicates "abstract-only" analysis

### Requirement: Manual PDF upgrade
The user SHALL be able to attach a local PDF file to a paper-reading task, and a subsequent analysis SHALL use that PDF as the full-text source when the link alone was insufficient.

#### Scenario: Attach local PDF
- **WHEN** the user attaches a PDF to an abstract-only analyzed task and requests re-analysis
- **THEN** the new analysis is based on the attached PDF and the abstract-only label is removed

### Requirement: Analysis results panel
The task detail panel for an analyzed paper SHALL show: a summary (tldr, contributions, method, key results), and reading suggestions (estimated effort, suggested reading order, questions to consider while reading). Suggestions SHALL be presented as structured, readable cards rather than raw text.

#### Scenario: View analysis
- **WHEN** the user clicks a successfully analyzed paper task
- **THEN** the detail panel shows the summary and reading-suggestion cards

#### Scenario: Analysis still running
- **WHEN** the user clicks a paper task whose analysis is in progress
- **THEN** the panel shows progress with the current step instead of results

### Requirement: Reading notes editor
Each paper-reading task SHALL provide a markdown notes area. Notes SHALL support markdown, autosave continuously to a local file in the app vault, and survive restarts. The notes area SHALL be available regardless of analysis state (user can write before analysis finishes).

#### Scenario: Write and persist notes
- **WHEN** the user types notes in a paper task's notes area and closes the app
- **THEN** the notes are intact and unchanged when the app reopens

### Requirement: Finish action
The system SHALL provide a "Finish" action on a paper-reading task. Finishing SHALL: mark the task completed, hand the reading note (plus the generated analysis summary and, when available, the paper PDF) to the learning-space ingestion flow, and give immediate confirmation without requiring the user to wait for or observe ingestion.

#### Scenario: Finish a paper task
- **WHEN** the user clicks Finish on a paper task with a reading note
- **THEN** the task is marked completed and the user regains control immediately while ingestion proceeds in the background

#### Scenario: Finish without notes
- **WHEN** the user clicks Finish on a paper task with an empty reading note
- **THEN** the system warns the user and requires confirmation before completing the task with no note to ingest

### Requirement: Analysis correctness safeguard
If the resolved paper at the provided link does not appear to match the provided full name, the system SHALL surface the mismatch for user confirmation rather than silently analyzing a possibly wrong paper.

#### Scenario: Link and title disagree
- **WHEN** the metadata title retrieved from the link differs substantially from the task's paper name
- **THEN** the task shows a mismatch warning and the user can confirm, correct the link, or attach the right PDF before analysis results are finalized
