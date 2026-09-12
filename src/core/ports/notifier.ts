// NotifierPort — how a service tells the user something happened.
//
// Two surfaces, deliberately different: `progress` is the running commentary
// shown while work is in flight, `toast` is a one-line outcome the user should
// not miss. Failures additionally reach the *activity record*, but that is
// written through StoragePort rather than here — the record is durable state
// the user can review and retry, not a notification (FR-028).

export interface NotifierPort {
  toast: (message: string, opts?: { view?: 'activity' }) => void
  progress: (stepLabel: string, progress?: string) => void
}
