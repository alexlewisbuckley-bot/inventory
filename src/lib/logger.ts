type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN: Level = process.env.NODE_ENV === 'production' ? 'info' : 'debug'

/**
 * Structured JSON logger. Emitting one object per line keeps output parseable
 * by log aggregators (Datadog, CloudWatch) without extra tooling.
 */
function emit(level: Level, message: string, meta: Record<string, unknown> = {}): void {
  if (ORDER[level] < ORDER[MIN]) return
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...meta })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => emit('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit('error', m, meta),
}
