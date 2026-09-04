import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { JobProgressEvent, ToastPayload } from '../../shared/ipc'
import type { AppSnapshot, ChatMessage, IngestRecord, List, PaperAnalysis, Settings, Suggestion, Task } from '../../shared/types'

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
export type View = 'my-day' | 'list'
export type DrawerView = 'activity' | 'settings' | 'chat'

interface AppContextValue extends AppState {
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
  chatMessages: ChatMessage[]
  chatStreaming: string | null
  chatRunning: boolean
  chatError: string | null
  sendChat: (text: string) => Promise<void>
  resetChat: () => Promise<void>
  setQuery: (q: string) => void
  searchTasks: (tasks: Task[]) => Task[]
  createList: (name: string) => Promise<List>
  renameList: (id: string, name: string) => Promise<List>
  deleteList: (id: string) => Promise<void>
  createTask: (args: { listId: string; title: string; notes?: string; type: 'plain' | 'paper_reading'; customTypeKey?: string | null; link?: string }) => Promise<Task>
  updateTask: (id: string, patch: { title?: string; notes?: string; link?: string; type?: 'plain' | 'paper_reading'; customTypeKey?: string | null }) => Promise<Task>
  deleteTask: (id: string) => Promise<void>
  toggleTask: (id: string) => Promise<Task>
  setMyDay: (id: string, inMyDay: boolean) => Promise<Task>
  saveNote: (taskId: string, content: string) => Promise<void>
  attachPdf: (taskId: string, pdfPath: string) => Promise<Task>
  requestReanalysis: (id: string) => Promise<Task>
  resolveMismatch: (id: string, action: 'confirm' | 'correct' | 'attach') => Promise<Task>
  retryJob: (jobId: string) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
  saveSettings: (s: Settings) => Promise<Settings>
  dismissSuggestion: (suggestionId: string) => Promise<Suggestion>
  retryIngest: (ingestId: string) => Promise<void>
  taskById: (id: string) => Task | undefined
  tasksForList: (listId: string) => Task[]
  myDayTasks: Task[]
  activity: IngestRecord[]
}

const AppCtx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatStreaming, setChatStreaming] = useState<string | null>(null)
  const [chatRunning, setChatRunning] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
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
    const offAnalysis = window.api.onAnalysisUpdated((a: PaperAnalysis) => {
      setSnapshot((prev) => {
        if (!prev) return prev
        return { ...prev, analyses: { ...prev.analyses, [a.taskId]: a } }
      })
    })
    const offSug = window.api.onSuggestionsUpdated((s: Suggestion[]) => {
      setSnapshot((prev) => {
        if (!prev) return prev
        return { ...prev, suggestions: s }
      })
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
    const offIngestProgress = window.api.onIngestProgress((e) => {
      setIngestSteps((prev) => ({ ...prev, [e.ingestId]: e.stepLabel }))
    })
    const offChatDelta = window.api.onChatDelta((e) => {
      setChatStreaming((prev) => (prev ?? '') + e.delta)
    })
    const offChatDone = window.api.onChatDone((e) => {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: e.text }])
      setChatStreaming(null)
      setChatRunning(false)
    })
    const offChatError = window.api.onChatError((e) => {
      setChatStreaming(null)
      setChatRunning(false)
      setChatError(e.error)
    })
    return () => {
      offTask()
      offList()
      offJob()
      offAnalysis()
      offSug()
      offToast()
      offIngest()
      offIngestProgress()
      offChatDelta()
      offChatDone()
      offChatError()
    }
  }, [mutateTask, refresh])

  const value = useMemo<AppContextValue>(() => {
    const snap = snapshot
    return {
      snapshot: snap,
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
      chatMessages,
      chatStreaming,
      chatRunning,
      chatError,
      sendChat: async (text) => {
        setChatError(null)
        setChatMessages((prev) => [...prev, { role: 'user', content: text }])
        setChatRunning(true)
        await window.api.sendChat(text)
      },
      resetChat: async () => {
        await window.api.resetChat()
        setChatMessages([])
        setChatStreaming(null)
        setChatRunning(false)
        setChatError(null)
      },
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
      updateTask: async (id, patch) => {
        const t = await window.api.updateTask({ id, ...patch })
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
      saveNote: async (taskId, content) => {
        const n = await window.api.saveNote({ taskId, content })
        // Keep the snapshot's notes fresh so controlled editors (plain-task
        // textarea) reflect what was saved.
        setSnapshot((prev) => prev && { ...prev, notes: { ...prev.notes, [taskId]: n } })
      },
      attachPdf: async (taskId, pdfPath) => {
        const t = await window.api.attachPdf({ taskId, pdfPath })
        mutateTask(t)
        return t
      },
      requestReanalysis: async (id) => {
        const t = await window.api.requestReanalysis({ id })
        mutateTask(t)
        return t
      },
      resolveMismatch: async (id, action) => {
        const t = await window.api.resolveMismatch({ id, action })
        mutateTask(t)
        return t
      },
      retryJob: (jobId) => window.api.retryJob({ jobId }),
      cancelJob: (jobId) => window.api.cancelJob({ jobId }),
      saveSettings: async (s) => {
        const saved = await window.api.saveSettings({ settings: s })
        await refresh()
        return saved
      },
      dismissSuggestion: async (suggestionId) => {
        const s = await window.api.dismissSuggestion({ suggestionId })
        await refresh()
        return s
      },
      retryIngest: (ingestId) => window.api.retryIngest({ ingestId }),
      taskById: (id) => snap?.tasks.find((t) => t.id === id),
      tasksForList: (listId) => (snap?.tasks ?? []).filter((t) => t.listId === listId),
      myDayTasks: (snap?.tasks ?? []).filter((t) => t.inMyDay),
      activity: snap?.ingestHistory ?? [],
      query,
      setQuery,
      searchTasks: (tasks) => {
        const q = query.trim().toLowerCase()
        if (!q) return tasks
        return tasks.filter((t) => {
          const a = snap?.analyses[t.id]
          return (
            t.title.toLowerCase().includes(q) ||
            (t.paperTitle ?? '').toLowerCase().includes(q) ||
            t.notes.toLowerCase().includes(q) ||
            (a?.tldr ?? '').toLowerCase().includes(q)
          )
        })
      }
    }
  }, [
    snapshot,
    loading,
    activeView,
    drawer,
    selectedTaskId,
    selectedListId,
    jobSteps,
    toast,
    liveJobs,
    ingestSteps,
    chatMessages,
    chatStreaming,
    chatRunning,
    chatError,
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
