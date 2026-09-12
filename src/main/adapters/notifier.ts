import type { NotifierPort } from '../../core/ports/notifier'

// The NotifierPort implementation over Electron's IPC broadcast.
//
// The sink is injected rather than imported so the services stay
// Electron-free — the same reason the alarm scheduler takes its notifier as a
// parameter.

export interface NotifierSink {
  toast: (message: string, opts?: { view?: 'activity' }) => void
  progress: (stepLabel: string, progress?: string) => void
}

export function createNotifier(sink: NotifierSink): NotifierPort {
  return {
    toast: (message, opts) => sink.toast(message, opts),
    progress: (stepLabel, progress) => sink.progress(stepLabel, progress)
  }
}
