import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSnapshot, IngestRecord, List, PaperAnalysis, Settings, Suggestion, Task } from '../../shared/types'

interface AppState {
  snapshot: AppSnapshot | null
  loading: boolean
  activeView: View
  selectedTaskId: string | null
  selectedListId: string | null
  jobSteps: Record<string, { stepLabel: string | null; state: string }>
}

export type View = 'my-day' | 'list' | 'activity' | 'settings'

interface AppContextValue extends AppState {
  setActiveView: (v: View) => void
  selectList: (listId: string | null) => void
  selectTask: (taskId: string | null) => void
  refresh: () => Promise<void>
  createList: (name: string) => Promise<List>
  renameList: (id: string, name: string) => Promise<List>
  deleteList: (id: string) => Promise<void>
  createTask: (args: { listId: string; title: string; notes?: string; type: 'plain' | 'paper_reading'; link?: string }) => Promise<Task>
  updateTask: (id: string, patch: { title?: string; notes?: string; link?: string }) => Promise<Task>
  deleteTask: (id: string) => Promise<void>
  toggleTask: (id: string) => Promise<Task>
  setMyDay: (id: string, inMyDay: boolean) => Promise<Task>
  saveNote: (taskId: string, content: string) => Promise<void>
  attachPdf: (taskId: string, pdfPath: string) => Promise<Task>
  requestReanalysis: (id: string) => Promise<Task>
  resolveMismatch: (id: string, action: 'confirm' | 'correct' | 'attach') => Promise<Task>
  retryJob: (jobId: string) => Promise<void>
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
  const [activeView, setActiveViewRaw] = useState<View>('list')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [jobSteps, setJobSteps] = useState<Record<string, { stepLabel: string | null; state: string }>>({})
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

  const setActiveView = useCallback(
    (v: View) => {
      setActiveViewRaw(v)
      if (v !== 'list') setSelectedTaskId(null)
    },
    []
  )

  const selectList = useCallback((listId: string | null) => {
    setSelectedListId(listId)
    setSelectedTaskId(null)
  }, [])

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
      setJobSteps((prev) => ({ ...prev, [e.jobId]: { stepLabel: e.stepLabel, state: e.state } }))
      if (e.state === 'done' || e.state === 'failed') {
        setJobSteps((prev) => {
          const next = { ...prev }
          delete next[e.jobId]
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
    return () => {
      offTask()
      offList()
      offJob()
      offAnalysis()
      offSug()
    }
  }, [mutateTask, refresh])

  const value = useMemo<AppContextValue>(() => {
    const snap = snapshot
    return {
      snapshot: snap,
      loading,
      activeView,
      selectedTaskId,
      selectedListId,
      jobSteps,
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
        await window.api.saveNote({ taskId, content })
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
      activity: snap?.ingestHistory ?? []
    }
  }, [
    snapshot,
    loading,
    activeView,
    selectedTaskId,
    selectedListId,
    jobSteps,
    setActiveView,
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
