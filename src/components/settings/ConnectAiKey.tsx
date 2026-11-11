'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, TextField, useToast } from '@/components/ui'
import { forgetAnthropicKeyAction, saveAnthropicKeyAction } from '@/app/actions/ai-key'
import type { ActionState } from '@/app/actions/auth'
import type { KeySource } from '@/server/services/ai-key-service'

const INITIAL: ActionState = { ok: false }

/**
 * Connecting a key from here rather than from the hosting dashboard.
 *
 * Alex: "Can we add a setting and intsturctions to connect the API key."
 *
 * The key could only come from an environment variable, which this host
 * reads when the application is built — so changing it did nothing until the
 * next deploy. That is the least obvious of the reasons these features stop,
 * because everything looks correctly configured while the running copy holds
 * the old value. A key set here works on the next request.
 */
export function ConnectAiKey({ source, hint, updatedAt }: {
  source: KeySource
  hint: string | null
  updatedAt: string | null
}) {
  const toast = useToast()
  const [state, formAction] = useFormState(saveAnthropicKeyAction, INITIAL)
  const [forgetting, setForgetting] = useState(false)

  useEffect(() => {
    if (state.ok && state.message) toast.success('Key connected', state.message)
  }, [state.ok, state.message, toast])

  const forget = async () => {
    setForgetting(true)
    const result = await forgetAnthropicKeyAction()
    setForgetting(false)
    if (result.ok) toast.success('Key removed', result.message)
  }

  return (
    <Card>
      <CardHeader
        title="Connect a key"
        description="Set here, it works on the next request. There is no deploy to wait for."
      />
      <CardBody className="space-y-4">
        <Where source={source} hint={hint} updatedAt={updatedAt} />

        <form action={formAction} className="space-y-3">
          <TextField
            name="key"
            label={source === 'stored' ? 'Replace the key' : 'API key'}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            error={state.errors?.key}
            hint="Checked against the API before it is saved, so a key that does not work is refused here rather than found later."
          />
          {state.message && !state.ok && (
            <p role="alert" className="flex items-start gap-1.5 text-small text-state-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{state.message}</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <SaveButton />
            {source === 'stored' && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void forget()} disabled={forgetting}>
                {forgetting ? 'Removing…' : 'Remove it'}
              </Button>
            )}
          </div>
        </form>

        <Instructions />
      </CardBody>
    </Card>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" loading={pending}>
      {pending ? 'Checking it…' : 'Check and connect'}
    </Button>
  )
}

/**
 * Which key is actually in use.
 *
 * The one thing somebody needs before changing anything, now that a key can
 * come from two places — and the commonest mistake is about to be setting it
 * in the one being overridden by the other.
 */
function Where({ source, hint, updatedAt }: { source: KeySource; hint: string | null; updatedAt: string | null }) {
  if (source === 'none') {
    return (
      <p className="flex items-start gap-1.5 text-small text-content-secondary">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-state-warning" aria-hidden />
        <span>No key anywhere, so reading invoices and photographs is switched off.</span>
      </p>
    )
  }
  return (
    <p className="flex items-start gap-1.5 text-small text-content-secondary">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-state-success" aria-hidden />
      <span>
        {source === 'stored' ? (
          <>
            Using the key set here <span className="font-bold text-content-primary">({hint})</span>
            {updatedAt && <>, since {updatedAt}</>}. It overrides anything on the deployment.
          </>
        ) : (
          <>
            Using <code>ANTHROPIC_API_KEY</code> from the deployment{' '}
            <span className="font-bold text-content-primary">({hint})</span>. Setting one here replaces it,
            and takes effect without a deploy.
          </>
        )}
      </span>
    </p>
  )
}

/** Where a key comes from, in the order somebody does it. */
function Instructions() {
  return (
    <div className="rounded-md bg-surface-subtle px-3.5 py-3">
      <p className="text-caption font-semibold text-content-secondary">Getting a key</p>
      <ol className="mt-1.5 space-y-1.5 text-small text-content-secondary">
        <li>
          <b className="text-content-primary">1.</b> Sign in at{' '}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-bold text-content-accent hover:underline"
          >
            console.anthropic.com
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>{' '}
          and create an API key. A normal one, not an admin key — an admin key cannot read documents.
        </li>
        <li>
          <b className="text-content-primary">2.</b> Put credit on the account under Billing. A valid key on an
          account with no money is the commonest way this stops working, and it looks exactly like a broken key.
        </li>
        <li>
          <b className="text-content-primary">3.</b> Paste the key above. It is checked before it is saved, kept
          encrypted, and never shown again — only its length.
        </li>
      </ol>
      <p className="mt-2 text-caption text-content-muted">
        Reading one watch from its photographs costs around four cents. Set a monthly ceiling in Settings if you
        want a hard stop.
      </p>
    </div>
  )
}
