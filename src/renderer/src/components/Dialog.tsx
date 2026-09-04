import { useEffect, useState } from 'react'

// Themed in-app dialogs replacing native confirm()/prompt() (spec app-layout).
// useDialog returns promise-based confirm/prompt plus the rendered dialog.

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

interface PromptOptions extends ConfirmOptions {
  placeholder?: string
}

interface DialogState {
  kind: 'confirm' | 'prompt'
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  placeholder?: string
  resolve: (value: boolean | string | null) => void
}

export function useDialog() {
  const [state, setState] = useState<DialogState | null>(null)
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    setInputValue('')
  }, [state])

  const close = (value: boolean | string | null) => {
    state?.resolve(value)
    setState(null)
  }

  const confirm = (opts: ConfirmOptions): Promise<boolean> =>
    new Promise((resolve) => {
      setState({
        kind: 'confirm',
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        danger: opts.danger,
        resolve: (v) => resolve(v === true)
      })
    })

  const prompt = (opts: PromptOptions): Promise<string | null> =>
    new Promise((resolve) => {
      setState({
        kind: 'prompt',
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'OK',
        placeholder: opts.placeholder,
        resolve: (v) => resolve(typeof v === 'string' ? v : null)
      })
    })

  const dialog = state ? (
    <div className="modal-backdrop" onClick={() => close(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-tag">{state.danger ? 'Danger' : state.kind === 'prompt' ? 'Input' : 'Confirm'}</span>
          <h3>{state.title}</h3>
        </div>
        <div className="modal-body">
          <p className="dialog-msg">{state.message}</p>
          {state.kind === 'prompt' && (
            <input
              autoFocus
              className="dialog-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={state.placeholder}
              onKeyDown={(e) => {
                if (e.key === 'Enter') close(inputValue)
                if (e.key === 'Escape') close(null)
              }}
            />
          )}
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={() => close(null)}>
            Cancel
          </button>
          {state.kind === 'confirm' ? (
            <button className={state.danger ? 'danger-btn' : 'primary-btn'} onClick={() => close(true)}>
              {state.confirmLabel}
            </button>
          ) : (
            <button className="primary-btn" onClick={() => close(inputValue)}>
              {state.confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null

  return { confirm, prompt, dialog }
}
