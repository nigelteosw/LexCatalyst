import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clearOpenrouterKey, getBirdieSettings, updateBirdieSettings } from '../../shared/api/api'
import { getErrorMessage } from '../../shared/lib/errors'

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5'

export function BirdieSettingsSection() {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const settingsQuery = useQuery({ queryKey: ['birdieSettings'], queryFn: getBirdieSettings })
  const settings = settingsQuery.data

  const saveMutation = useMutation({
    mutationFn: () =>
      updateBirdieSettings({
        openrouterApiKey: apiKey.trim() || undefined,
        openrouterModel: (model ?? settings?.openrouterModel ?? '').trim() || null,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['birdieSettings'], saved)
      setApiKey('')
      setModel(null)
      setMessage({ tone: 'ok', text: 'Birdie settings saved.' })
    },
    onError: (error) => setMessage({ tone: 'error', text: getErrorMessage(error) }),
  })

  const removeMutation = useMutation({
    mutationFn: clearOpenrouterKey,
    onSuccess: (saved) => {
      queryClient.setQueryData(['birdieSettings'], saved)
      setMessage({ tone: 'ok', text: 'Key removed. Birdie is using the firm default.' })
    },
    onError: (error) => setMessage({ tone: 'error', text: getErrorMessage(error) }),
  })

  const hasKey = settings?.hasOpenrouterKey ?? false
  const keyTooShort = apiKey.length > 0 && apiKey.trim().length < 10
  const canSave = (apiKey.trim().length >= 10 || (hasKey && model !== null)) && !saveMutation.isPending

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4">
      <h3 className="text-sm font-semibold text-[#0f0f0f]">Birdie model</h3>
      <p className="mt-1 text-xs leading-5 text-[#6f6f69]">
        {hasKey
          ? `Birdie is using your OpenRouter key (…${settings?.keyLast4}) with ${settings?.effectiveModel}.`
          : 'Birdie is using the firm default (DeepSeek). Add your own OpenRouter key to choose the model.'}
      </p>

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) saveMutation.mutate()
        }}
      >
        <label className="block">
          <span className="text-xs font-medium text-[#0f0f0f]">OpenRouter API key</span>
          <input
            autoComplete="off"
            className="mt-1 h-9 w-full rounded-lg border border-black/15 bg-white px-3 text-xs outline-none focus:border-black/40"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasKey ? 'Enter a new key to replace the saved one' : 'sk-or-…'}
            spellCheck={false}
            type="password"
            value={apiKey}
          />
          {keyTooShort && (
            <span className="mt-1 block text-[11px] text-red-600">That key looks too short.</span>
          )}
        </label>
        <label className="block">
          <span className="text-xs font-medium text-[#0f0f0f]">Model</span>
          <input
            className="mt-1 h-9 w-full rounded-lg border border-black/15 bg-white px-3 text-xs outline-none focus:border-black/40"
            onChange={(event) => setModel(event.target.value)}
            placeholder={DEFAULT_MODEL}
            spellCheck={false}
            type="text"
            value={model ?? settings?.openrouterModel ?? ''}
          />
        </label>

        <p className="text-[11px] leading-4 text-[#8c8c86]">
          With your own key, Birdie prompts — including document excerpts, Knowledge Bank entries and
          reviewer feedback — are sent to OpenRouter and the model provider you choose.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="inline-flex h-9 items-center rounded-lg bg-[#0f0f0f] px-4 text-xs font-medium text-white disabled:opacity-40"
            disabled={!canSave}
            type="submit"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          {hasKey && (
            <button
              className="inline-flex h-9 items-center rounded-lg border border-red-100 bg-white px-4 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
              type="button"
            >
              Remove key
            </button>
          )}
          {message && (
            <span
              className={`text-xs ${message.tone === 'ok' ? 'text-[#1a6b4a]' : 'text-red-600'}`}
              role="status"
            >
              {message.text}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
