// ClockPort — time, so core stays testable and deterministic.

export interface ClockPort {
  /** Current time as an ISO-8601 string (the app's persisted timestamp format). */
  nowIso(): string
}

export const systemClock: ClockPort = {
  nowIso: () => new Date().toISOString()
}
