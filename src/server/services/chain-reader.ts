import { normaliseAddress, usdFromRaw } from '@/lib/usdt'
import { USDT_CONTRACTS, USDT_DECIMALS, type WalletChain } from '@/lib/enums'
import { logger } from '@/lib/logger'
import { explorerKey } from './explorer-keys'

/**
 * Reading a wallet off the chain.
 *
 * Alex: "there should be a feature to scan the USDT wallet address and link
 * them to transactions accordingly."
 *
 * Two public explorers, read-only, no key material of ours anywhere near
 * them. This module knows how each one words a transfer and turns both into
 * the same four facts: who, when, how much, which transaction. Everything
 * above it — matching, flagging, the screen — works on that shape and has
 * never heard of TRON.
 *
 * What it deliberately does not do: anything that could move money. There is
 * no signing here, no private key, no transaction construction. The worst a
 * compromise of this file could achieve is reading a public ledger that is
 * already public.
 */

export interface ChainTransfer {
  txHash: string
  from: string
  to: string
  /** The chain's own integer, as text. */
  amountRaw: string
  /** The same figure in cents, or null where the row could not be trusted. */
  amountUsd: number | null
  contract: string
  symbol: string
  blockTime: Date
  raw: Record<string, unknown>
}

/** What a read came back with, and whether it was cut short. */
export interface ChainRead {
  transfers: ChainTransfer[]
  /** Set where a rate limit stopped the read before it ran out of pages. */
  stoppedBy?: string
}

export interface FetchOptions {
  /** Nothing before this. The first scan of an old wallet is otherwise its whole life. */
  since?: Date | null
  /** A ceiling on one run, so a wallet with a long history cannot hang a request. */
  limit?: number
}

/**
 * A pause between pages.
 *
 * TronGrid's free tier is metered per second, and ten pages fired back to
 * back is the surest way to meet it. A quarter of a second between them costs
 * a scan two seconds and takes the commonest cause of a 429 off the table.
 */
const PAGE_PAUSE_MS = 250

/** A page at a time from the explorers, and a run of pages at most this long. */
const PAGE = 200
const MAX_PAGES = 10
const DEFAULT_LIMIT = 500

/** Long enough for a slow explorer, short enough not to hang a server action. */
const TIMEOUT_MS = 20_000

export class ChainError extends Error {
  constructor(message: string, readonly chain: WalletChain) {
    super(message)
    this.name = 'ChainError'
  }
}

/**
 * How long to wait before trying again, and whether to bother.
 *
 * Alex, on the first real scan: "The chain could not be read. TRC Main
 * Wallet: the explorer answered 429."
 *
 * 429 is TronGrid's rate limiter, and it is the ordinary answer rather than a
 * fault: the free endpoint is metered per IP, and a deployment shares its IP
 * with every other tenant on that host. So the limit is reached by other
 * people's traffic as readily as by ours, and the right response is to wait
 * and ask again rather than to report that the chain is unreadable.
 *
 * `Retry-After` is honoured where the explorer sends one, because its own
 * number is better than our guess. Otherwise it doubles: a second, two, four.
 *
 * A 5xx is retried for the same reason. A 4xx that is not 429 is not — a bad
 * key or a malformed address will say the same thing however many times it is
 * asked, and retrying it only makes somebody wait longer for the same answer.
 */
export function waitFor(status: number, attempt: number, retryAfter?: string | null): number | null {
  const retryable = status === 429 || (status >= 500 && status < 600)
  if (!retryable || attempt >= MAX_ATTEMPTS) return null

  const asked = Number(retryAfter)
  if (Number.isFinite(asked) && asked > 0) {
    // Seconds, by the standard. Capped, because an explorer asking for five
    // minutes is asking for longer than a scan is allowed to take.
    return Math.min(asked * 1000, MAX_BACKOFF_MS)
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

/** Three goes at a page: the first, then two retries. */
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 1_200
const MAX_BACKOFF_MS = 6_000

const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * What a rate limit means to the person who pressed the button.
 *
 * "The explorer answered 429" is the truth and is no use: it names the
 * mechanism rather than the fix. A free key raises TronGrid's ceiling by
 * better than an order of magnitude, and the box to paste it into is on the
 * same screen as the error.
 */
function limitMessage(chain: WalletChain): string {
  return chain === 'TRON'
    ? 'TronGrid is rate-limiting us. A free TronGrid key raises the limit a long way — '
      + 'paste one into Explorer keys below, or wait a minute and scan again.'
    : 'Etherscan is rate-limiting us. Wait a minute and scan again, or use a key with a higher tier.'
}

async function getJson(
  url: string, chain: WalletChain, headers: Record<string, string> = {},
): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', ...headers },
        signal: controller.signal,
        cache: 'no-store',
      })
      if (response.ok) return await response.json()

      const wait = waitFor(response.status, attempt, response.headers.get('retry-after'))
      if (wait === null) {
        throw new ChainError(
          response.status === 429
            ? limitMessage(chain)
            : `the explorer answered ${response.status}`,
          chain,
        )
      }
      logger.info('the explorer asked us to slow down', { chain, status: response.status, wait })
      await sleep(wait)
    } finally {
      clearTimeout(timer)
    }
  }
}

/* ----------------------------------------------------------------- TRON -- */

/**
 * TronGrid, which is the endpoint Tronscan itself reads.
 *
 * Works without a key at a low rate, which is enough for a desk scanning a
 * handful of wallets a few times a day; a key raises the ceiling and is set
 * in settings rather than in a deploy.
 *
 * `min_timestamp` is milliseconds, and the response carries a fingerprint for
 * the next page rather than a page number.
 */
async function fetchTron(address: string, options: FetchOptions): Promise<ChainRead> {
  const key = await explorerKey('TRON')
  const limit = options.limit ?? DEFAULT_LIMIT
  const contract = USDT_CONTRACTS.TRON
  const found: ChainTransfer[] = []
  let fingerprint: string | null = null

  for (let page = 0; page < MAX_PAGES && found.length < limit; page += 1) {
    try {
    const url = new URL(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`)
    url.searchParams.set('contract_address', contract)
    url.searchParams.set('limit', String(Math.min(PAGE, limit - found.length)))
    url.searchParams.set('order_by', 'block_timestamp,desc')
    if (options.since) url.searchParams.set('min_timestamp', String(options.since.getTime()))
    if (fingerprint) url.searchParams.set('fingerprint', fingerprint)

    if (page > 0) await sleep(PAGE_PAUSE_MS)
    const body = await getJson(url.toString(), 'TRON', key ? { 'TRON-PRO-API-KEY': key } : {})
    const page_ = body as {
      success?: boolean
      error?: unknown
      data?: unknown[]
      meta?: { fingerprint?: string }
    }
    if (page_.success === false) {
      throw new ChainError(String(page_.error ?? 'TronGrid refused the request'), 'TRON')
    }

    const rows = Array.isArray(page_.data) ? page_.data : []
    for (const row of rows) {
      const transfer = readTronRow(row)
      if (transfer) found.push(transfer)
    }

    fingerprint = page_.meta?.fingerprint ?? null
    if (!fingerprint || rows.length === 0) break
    } catch (error) {
      /*
       * Keep what arrived before the limit did.
       *
       * Throwing here lost four pages of real transfers because the fifth
       * was refused — and the next scan would have had to read them all
       * again. What is held is stored, the run says it was cut short, and
       * because a transfer is recognised by its own content a re-scan costs
       * nothing but time.
       */
      if (found.length > 0 && error instanceof ChainError) {
        return { transfers: found, stoppedBy: error.message }
      }
      throw error
    }
  }

  return { transfers: found }
}

/**
 * One TronGrid row.
 *
 * Written defensively on purpose: an explorer that changes a field name
 * should cost us a transfer we can see is missing, not a payment silently
 * recorded as nothing. A row that cannot be read whole is dropped and logged
 * rather than half-read.
 */
export function readTronRow(row: unknown): ChainTransfer | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const info = (r.token_info ?? {}) as Record<string, unknown>

  const txHash = typeof r.transaction_id === 'string' ? r.transaction_id : null
  const from = typeof r.from === 'string' ? r.from : null
  const to = typeof r.to === 'string' ? r.to : null
  const amountRaw = typeof r.value === 'string' ? r.value : null
  const at = typeof r.block_timestamp === 'number' ? r.block_timestamp : null
  if (!txHash || !from || !to || !amountRaw || !at) {
    logger.warn('tron transfer row could not be read', { keys: Object.keys(r) })
    return null
  }

  const decimals = typeof info.decimals === 'number' ? info.decimals : USDT_DECIMALS
  return {
    txHash,
    from,
    to,
    amountRaw,
    amountUsd: usdFromRaw(amountRaw, decimals),
    contract: typeof info.address === 'string' ? info.address : USDT_CONTRACTS.TRON,
    symbol: typeof info.symbol === 'string' ? info.symbol : 'USDT',
    blockTime: new Date(at),
    raw: r,
  }
}

/* ------------------------------------------------------------- Ethereum -- */

/**
 * Etherscan, through the versioned endpoint and a key.
 *
 * The key is not optional here, which is the one way the two chains differ
 * in practice: Etherscan refuses an unkeyed request rather than rate-limiting
 * it. A free key covers a desk's usage many times over, and it is set in
 * settings so a lapsed one can be replaced without a deploy.
 *
 * The URL shape is a setting too. Etherscan has moved its API between forms
 * more than once — a single endpoint carrying a chain id is the current one —
 * and a dealer whose payments stop reconciling because an explorer renamed a
 * path should be able to fix it in a text box rather than wait for us.
 */
async function fetchEthereum(address: string, options: FetchOptions): Promise<ChainRead> {
  const key = await explorerKey('ETHEREUM')
  if (!key) {
    throw new ChainError(
      'Etherscan needs an API key. Add one in Settings → Integrations and scan again.',
      'ETHEREUM',
    )
  }

  const limit = options.limit ?? DEFAULT_LIMIT
  const contract = USDT_CONTRACTS.ETHEREUM
  const found: ChainTransfer[] = []

  for (let page = 1; page <= MAX_PAGES && found.length < limit; page += 1) {
    try {
    const url = new URL(etherscanBase())
    url.searchParams.set('chainid', '1')
    url.searchParams.set('module', 'account')
    url.searchParams.set('action', 'tokentx')
    url.searchParams.set('contractaddress', contract)
    url.searchParams.set('address', address)
    url.searchParams.set('page', String(page))
    url.searchParams.set('offset', String(Math.min(PAGE, limit - found.length)))
    url.searchParams.set('sort', 'desc')
    url.searchParams.set('apikey', key)

    if (page > 1) await sleep(PAGE_PAUSE_MS)
    const body = await getJson(url.toString(), 'ETHEREUM')
    const answer = body as { status?: string; message?: string; result?: unknown }

    /*
     * "No transactions found" arrives as a failure status with an empty
     * result, which is not a failure: it is the answer for a wallet that has
     * not been paid yet, and treating it as an error would put a red banner
     * over a working scan.
     */
    if (answer.status !== '1') {
      const message = String(answer.message ?? '')
      if (/no transactions found/i.test(message)) break
      // Etherscan answers 200 with the limit in the body, so the status-code
      // retry above never sees it.
      if (/rate limit|max calls per sec/i.test(message)) {
        throw new ChainError(limitMessage('ETHEREUM'), 'ETHEREUM')
      }
      throw new ChainError(
        `Etherscan said: ${message || 'the request was refused'}`,
        'ETHEREUM',
      )
    }

    const rows = Array.isArray(answer.result) ? answer.result : []
    for (const row of rows) {
      const transfer = readEtherscanRow(row)
      if (!transfer) continue
      // The explorer returns everything from the beginning when asked for a
      // window it does not support, so the window is applied here as well.
      if (options.since && transfer.blockTime < options.since) continue
      found.push(transfer)
    }
    if (rows.length === 0) break
    } catch (error) {
      if (found.length > 0 && error instanceof ChainError) {
        return { transfers: found, stoppedBy: error.message }
      }
      throw error
    }
  }

  return { transfers: found }
}

/** Overridable, because an explorer's URL is not a thing worth a deploy. */
function etherscanBase(): string {
  return process.env.ETHERSCAN_API_URL?.trim() || 'https://api.etherscan.io/v2/api'
}

/** One Etherscan row, read with the same suspicion as a Tron one. */
export function readEtherscanRow(row: unknown): ChainTransfer | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>

  const txHash = typeof r.hash === 'string' ? r.hash : null
  const from = typeof r.from === 'string' ? r.from : null
  const to = typeof r.to === 'string' ? r.to : null
  const amountRaw = typeof r.value === 'string' ? r.value : null
  // Seconds, as a string, which is Etherscan's way.
  const at = typeof r.timeStamp === 'string' ? Number(r.timeStamp) : null
  if (!txHash || !from || !to || !amountRaw || !at || !Number.isFinite(at)) {
    logger.warn('etherscan transfer row could not be read', { keys: Object.keys(r) })
    return null
  }

  const decimals = Number(r.tokenDecimal)
  return {
    txHash,
    from: from.toLowerCase(),
    to: to.toLowerCase(),
    amountRaw,
    amountUsd: usdFromRaw(amountRaw, Number.isFinite(decimals) ? decimals : USDT_DECIMALS),
    contract: typeof r.contractAddress === 'string'
      ? r.contractAddress.toLowerCase()
      : USDT_CONTRACTS.ETHEREUM,
    symbol: typeof r.tokenSymbol === 'string' ? r.tokenSymbol : 'USDT',
    blockTime: new Date(at * 1000),
    raw: r,
  }
}

/* ------------------------------------------------------------------ API -- */

/** Every USDT transfer touching this address, newest first. */
export async function fetchTransfers(
  chain: WalletChain,
  address: string,
  options: FetchOptions = {},
): Promise<ChainRead> {
  const value = normaliseAddress(chain, address)
  const read = chain === 'TRON'
    ? await fetchTron(value, options)
    : await fetchEthereum(value, options)

  logger.info('wallet scanned', {
    chain, transfers: read.transfers.length, stopped: Boolean(read.stoppedBy),
  })
  return read
}

/**
 * Which way the money went, from our side.
 *
 * Both explorers answer "transfers touching this address", which includes
 * what went out. Money out matters as much as money in — a payment to a
 * supplier, a move between our own wallets — so it is kept and labelled
 * rather than filtered away at the door.
 */
export function directionFor(
  transfer: ChainTransfer,
  ours: string,
): { direction: 'IN' | 'OUT'; counterparty: string } {
  const mine = ours.toLowerCase()
  return transfer.to.toLowerCase() === mine
    ? { direction: 'IN', counterparty: transfer.from }
    : { direction: 'OUT', counterparty: transfer.to }
}
