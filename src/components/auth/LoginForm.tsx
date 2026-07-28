'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { AlertCircle } from 'lucide-react'
import { loginAction, type ActionState } from '@/app/actions/auth'
import { Button, TextField } from '@/components/ui'

const INITIAL: ActionState = { ok: false }

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, action] = useFormState(loginAction, INITIAL)

  return (
    <form action={action} className="mt-8 flex flex-col gap-4" noValidate>
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}

      {state.message && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-state-danger/30 bg-state-danger/8 px-4 py-3"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-state-danger" aria-hidden />
          <p className="text-small text-state-danger">{state.message}</p>
        </div>
      )}

      <TextField
        name="email"
        type="email"
        label="Email address"
        autoComplete="username"
        autoFocus
        required
        placeholder="you@bluecroft.co.uk"
        error={state.errors?.email}
      />
      <TextField
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
        error={state.errors?.password}
      />

      <SubmitButton />

      <p className="text-caption text-content-secondary">
        Trouble signing in? Contact an administrator to reset your password.
      </p>
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" fullWidth loading={pending} className="mt-2">
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  )
}
