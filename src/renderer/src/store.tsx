import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { CreateTaskArgs, JobProgressEvent, RemoteOutcomeView, RemoteProposalView, RemoveTypeResult, SaveTypeResult, ToastPayload, UpdateTaskArgs } from '../../shared/ipc'
import type { AppSnapshot, FinishMode, FinishReport, IngestRecord, List, RedactedSettings, Settings, SettingsInput, Task, TaskTypeDef } from '../../shared/types'
import { DEFAULT_LANGUAGE, localeOf, translator, type Language, type Translate } from '../../core/i18n'

interface AppState {
  snapshot: AppSnapshot | null
  loading: boolean
  activeView: View
  selectedTaskId: string | null
  selectedListId: string | null
  jobSteps: Record<string, { stepLabel: string | null; state: string }>
  query: string
}

// Task column mode (board): what the middle column shows. Auxiliary surfaces
// (Activity/Settings/Chat) are drawers, not views.
export type View = 'my-day' | 'todo'
// The debug-chat drawer is retired with the in-memory transcript (T027):
// conversations are task-owned stored state and live in the focus column.
export type DrawerView = 'activity' | 'settings'

interface AppContextValue extends AppState {
  /** The language the app's own text is shown in (Settings → Appearance). */
  language: Language
  /** The BCP-47 tag dates are formatted with, derived from `language`. */
  locale: string
  /** `message(language, …)`, bound. Stable per language, so it is safe in deps. */
  t: Translate
  setActiveView: (v: View) => void
  drawer: DrawerView | null
  openDrawer: (d: DrawerView) => void
  closeDrawer: () => void
  selectList: (listId: string | null) => void
  selectTask: (taskId: string | null) => void
  refresh: () => Promise<void>
  toast: ToastPayload | null
  notify: (message: string, view?: 'activity') => void
  dismissToast: () => void
  liveJobs: JobProgressEvent[]
  ingestSteps: Record<string, string | null>
  setQuery: (q: string) => void
  searchTasks: (tasks: Task[]) => Task[]
  createList: (name: string) => Promise<List>
  renameList: (id: string, name: string) => Promise<List>
  deleteList: (id: string) => Promise<void>
  createTask: (args: CreateTaskArgs) => Promise<Task>
  updateTask: (args: UpdateTaskArgs) => Promise<Task>
  deleteTask: (id: string) => Promise<void>
  toggleTask: (id: string) => Promise<Task>
  setMyDay: (id: string, inMyDay: boolean) => Promise<Task>
  setAlarm: (id: string, alarmAt: string | null) => Promise<Task>
  finishTask: (id: string, mode?: FinishMode) => Promise<FinishReport>
  saveNote: (taskId: string, content: string) => Promise<void>
  saveType: (type: TaskTypeDef) => Promise<SaveTypeResult>
  removeType: (key: string) => Promise<RemoveTypeResult>
  retryJob: (jobId: string) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
  saveSettings: (s: SettingsInput) => Promise<RedactedSettings>
  retryIngest: (ingestId: string) => Promise<void>
  proposals: RemoteProposalView[]
  confirmRemoteChange: (proposalId: string) => Promise<RemoteOutcomeView>
  dismissProposal: (proposalId: string) => Promise<void>
  taskById: (id: string) => Task | undefined
  tasksForList: (listId: string) => Task[]
  myDayTasks: Task[]
  activity: IngestRecord[]
  types: TaskTypeDef[]
}

const AppCtx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  // Pending remote-change proposals. Held outside the snapshot: they are
  // per-session working state, not persisted configuration.
  const [proposals, setProposals] = useState<RemoteProposalView[]>([])
  const [loading, setLoading] = useState(true)
  const [activeView, setActiveViewRaw] = useState<View>('my-day')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerView | null>(null)
  const [jobSteps, setJobSteps] = useState<Record<string, { stepLabel: string | null; state: string }>>({})
  const [toast, setToast] = useState<ToastPayload | null>(null)
  const [query, setQuery] = useState('')
  const [liveJobs, setLiveJobs] = useState<Record<string, JobProgressEvent>>({})
  const [ingestSteps, setIngestSteps] = useState<Record<string, string | null>>({})
  const snapshotRef = useRef<AppSnapshot | null>(null)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const applySnapshot = useCallback((s: AppSnapshot) => {
    setSnapshot(s)
    snapshotRef.current = s
  }, [])

  const refresh = useCallback(async () => {
    const s = await window.api.getSnapshot()
    applySnapshot(s)
    setLoading(false)
  }, [applySnapshot])

  const mutateTask = useCallback((t: Task) => {
    setSnapshot((prev) => {
      if (!prev) return prev
      const exists = prev.tasks.some((x) => x.id === t.id)
      const tasks = exists ? prev.tasks.map((x) => (x.id === t.id ? t : x)) : [...prev.tasks, t]
      return { ...prev, tasks }
    })
  }, [])

  // Board mode switch only; the focus-column selection is independent of the
  // task column's mode (spec app-layout: opening drawers or switching modes
  // never clears the selected task).
  const setActiveView = useCallback((v: View) => setActiveViewRaw(v), [])

  const openDrawer = useCallback((d: DrawerView) => setDrawer(d), [])
  const closeDrawer = useCallback(() => setDrawer(null), [])

  const selectList = useCallback((listId: string | null) => setSelectedListId(listId), [])

  const selectTask = useCallback((taskId: string | null) => setSelectedTaskId(taskId), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Event subscriptions from main.
  useEffect(() => {
    const offTask = window.api.onTaskUpdated((t) => {
      if ((t as any).deleted) {
        setSnapshot((prev) => prev && { ...prev, tasks: prev.tasks.filter((x) => x.id !== t.id) })
        return
      }
      mutateTask(t)
    })
    const offList = window.api.onListUpdated(() => void refresh())
    const offJob = window.api.onJobProgress((e) => {
      const key = e.taskId ?? e.jobId
      setJobSteps((prev) => ({ ...prev, [key]: { stepLabel: e.stepLabel, state: e.state } }))
      setLiveJobs((prev) => ({ ...prev, [e.jobId]: e }))
      if (e.state === 'done' || e.state === 'failed') {
        setJobSteps((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      }
    })
    const offSettings = window.api.onSettingsUpdated((s) => {
      setSnapshot((prev) => (prev ? { ...prev, settings: s } : prev))
    })
    const offTypes = window.api.onTypesUpdated((types) => {
      setSnapshot((prev) => (prev ? { ...prev, taskTypes: types } : prev))
    })
    const offToast = window.api.onToast((t) => {
      setToast({ message: t.message, view: t.view })
      setTimeout(() => setToast(null), 4000)
    })
    const offIngest = window.api.onIngestUpdated((rec) => {
      setSnapshot((prev) => {
        if (!prev) return prev
        const exists = prev.ingestHistory.some((x) => x.id === rec.id)
        return {
          ...prev,
          ingestHistory: exists ? prev.ingestHistory.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...prev.ingestHistory]
        }
      })
    })
    const offProposals = window.api.onProposals((p) => setProposals(p))
    const offIngestProgress = window.api.onIngestProgress((e) => {
      setIngestSteps((prev) => ({ ...prev, [e.ingestId]: e.stepLabel }))
    })
    // Conversation events are consumed by the ChatPanel that owns the
    // surface (T029): the transcript is per-conversation stored state, not a
    // store-level cache, so the subscriptions live with the panel.
    const offOpenTask = window.api.onOpenTask((taskId) => {
      setSelectedTaskId(taskId)
    })
    return () => {
      offTask()
      offList()
      offJob()
      offSettings()
      offTypes()
      offToast()
      offIngest()
      offProposals()
      offIngestProgress()
      offOpenTask()
    }
  }, [mutateTask, refresh])

  // The language rides the snapshot, so it arrives with every settings change
  // and needs no context of its own. Derived here rather than inside the value
  // memo so `t` keeps one identity per language: a component that memoises on
  // `t` should recompute when the language changes, not on every task update.
  //
  // Note for anyone tempted to call `useT()` in this component: AppProvider IS
  // the provider, so `useApp()` would throw. It reads `t` from here directly.
  const language = snapshot?.settings.uiLanguage ?? DEFAULT_LANGUAGE
  const t = useMemo(() => translator(language), [language])
  const locale = localeOf(language)

  const value = useMemo<AppContextValue>(() => {
    const snap = snapshot
    return {
      snapshot: snap,
      language,
      locale,
      t,
      loading,
      activeView,
      drawer,
      openDrawer,
      closeDrawer,
      selectedTaskId,
      selectedListId,
      jobSteps,
      toast,
      notify: (message, view) => {
        setToast({ message, view })
        setTimeout(() => setToast(null), 4000)
      },
      dismissToast: () => setToast(null),
      liveJobs: Object.values(liveJobs).sort((a, b) => a.jobId.localeCompare(b.jobId)),
      ingestSteps,
      setActiveView,
      selectList,
      selectTask,
      refresh,
      createList: async (name) => {
        const l = await window.api.createList({ name })
        await refresh()
        return l
      },
      renameList: async (id, name) => {
        const l = await window.api.renameList({ id, name })
        await refresh()
        return l
      },
      deleteList: async (id) => {
        await window.api.deleteList({ id })
        await refresh()
      },
      createTask: async (args) => {
        const t = await window.api.createTask(args)
        mutateTask(t)
        return t
      },
      updateTask: async (args) => {
        const t = await window.api.updateTask(args)
        mutateTask(t)
        return t
      },
      deleteTask: async (id) => {
        await window.api.deleteTask({ id })
        await refresh()
      },
      toggleTask: async (id) => {
        const t = await window.api.toggleTask({ id })
        mutateTask(t)
        return t
      },
      setMyDay: async (id, inMyDay) => {
        const t = await window.api.setMyDay({ id, inMyDay })
        mutateTask(t)
        return t
      },
      setAlarm: async (id, alarmAt) => {
        const t = await window.api.setAlarm({ id, alarmAt })
        mutateTask(t)
        return t
      },
      finishTask: async (id, mode) => {
        // The result is the contract report (where the copy went, which path
        // ran); the finished task itself arrives through evTaskUpdated, which
        // the main handler broadcasts after the write succeeds.
        return window.api.finishTask({ taskId: id, mode })
      },
      saveNote: async (taskId, content) => {
        const n = await window.api.saveNote({ taskId, content })
        // Keep the snapshot's notes fresh so controlled editors reflect what
        // was saved.
        setSnapshot((prev) => prev && { ...prev, notes: { ...prev.notes, [taskId]: n } })
      },
      saveType: async (type) => {
        // The contract result: { ok, issues? } — a refusal arrives structured,
        // with its sentences already localized in main.
        const result = await window.api.saveType({ type })
        await refresh()
        return result
      },
      removeType: async (key) => {
        const result = await window.api.removeType({ key })
        await refresh()
        return result
      },
      retryJob: (jobId) => window.api.retryJob({ jobId }),
      cancelJob: (jobId) => window.api.cancelJob({ jobId }),
      saveSettings: async (s) => {
        const saved = await window.api.saveSettings({ settings: s })
        await refresh()
        return saved
      },
      retryIngest: (ingestId) => window.api.retryIngest({ ingestId }),
      confirmRemoteChange: (proposalId) => window.api.confirmRemoteChange({ proposalId }),
      dismissProposal: (proposalId) => window.api.dismissProposal({ proposalId }),
      taskById: (id) => snap?.tasks.find((t) => t.id === id),
      tasksForList: (listId) => (snap?.tasks ?? []).filter((t) => t.listId === listId),
      myDayTasks: (snap?.tasks ?? []).filter((t) => t.inMyDay),
      activity: snap?.ingestHistory ?? [],
      proposals,
      types: snap?.taskTypes ?? [],
      query,
      setQuery,
      searchTasks: (tasks) => {
        const q = query.trim().toLowerCase()
        if (!q) return tasks
        // Title and the task's own free text only: the retired preprocess
        // summary is history no surface reads (D4).
        return tasks.filter(
          (t) => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)
        )
      }
    }
  }, [
    snapshot,
    language,
    locale,
    t,
    loading,
    activeView,
    drawer,
    selectedTaskId,
    selectedListId,
    jobSteps,
    toast,
    liveJobs,
    ingestSteps,
    query,
    setActiveView,
    openDrawer,
    closeDrawer,
    selectList,
    selectTask,
    refresh,
    mutateTask
  ])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
