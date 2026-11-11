'use client'
import { useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button, Card, CardBody, CardHeader } from '@/components/ui'
import { testAnthropicKeyAction, type KeyTestResult } from '@/app/actions/ai'

/**
 * Does the key work, asked on demand.
 *
 * The question nothing in the application ever put until somebody dropped a
 * file on it — so a key that lapsed on a Tuesday was found on a Thursday by
 * somebody trying to book in a watch, and the only evidence was a red line
 * under a drop zone. A button that asks costs a hundredth of a cent and
 * turns "it keeps going off" into something with a date on it.
 */
export function KeyCheck({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<KeyTestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const check = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await testAnthropicKeyAction())
    } catch {
      setResult({ ok: false, message: 'The check itself could not be run.' })
    }
    setTesting(false)
  }

  return (
    <Card>
      <CardHeader
        title="The API key"
        description={configured
          ? 'Set on this deployment. Whether it still works is a different question.'
          : 'Not set on this deployment, so every AI feature is switched off rather than broken.'}
      />
      <CardBody className="space-y-3">
        <Button size="sm" variant="secondary" onClick={() => void check()} disabled={testing}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {testing ? 'Asking…' : 'Check it now'}
        </Button>

        {result && (
          <p
            role="status"
            className={`flex items-start gap-2 text-small ${result.ok ? 'text-content-primary' : 'text-state-danger'}`}
          >
            {result.ok
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-state-success" aria-hidden />
              : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <span>{result.message}</span>
          </p>
        )}

        {/* The three reasons these features stop, in the order they happen.
            Written down because each is somebody else's system and none of
            them announces itself here. */}
        <div className="rounded-md bg-surface-subtle px-3.5 py-3">
          <p className="text-caption font-semibold text-content-secondary">When it stops, it is almost always one of three</p>
          <ul className="mt-1.5 space-y-1 text-small text-content-secondary">
            <li>
              <b className="text-content-primary">The credit balance ran out.</b>{' '}
              Nothing changed here; the account simply has no money on it. Topping it up works
              immediately, with no redeploy.
            </li>
            <li>
              <b className="text-content-primary">The key changed but the deployment did not.</b>{' '}
              Environment variables are read when the application is built, so a new key does nothing
              until the next deploy.
            </li>
            <li>
              <b className="text-content-primary">The key was revoked.</b>{' '}
              Issue a new one, set it, and deploy.
            </li>
          </ul>
        </div>
      </CardBody>
    </Card>
  )
}
