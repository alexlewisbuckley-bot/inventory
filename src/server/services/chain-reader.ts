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
  /**
   * When this read must be finished, as a clock reading.
   *
   * Shared across the wallets in one scan rather than given to each, because
   * the thing being protected is the request they all run inside: two
   * wallets each waiting patiently is one wallet's patience twice over, and
   * the second one is what gets cut off.
   */
  deadline?: number
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
export function waitFor(
  status: number, attempt: number, retryAfter?: string | null, msLeft = Infinity,
): number | null {
  const retryable = status === 429 || (status >= 500 && status < 600)
  if (!retryable) return null

  /*
   * A rate limit is given far more patience than a server fault.
   *
   * They are different things wearing the same shape. A 5xx means the
   * explorer is unwell, and asking a fourth time does not mend it. A 429
   * means we asked too fast — the one failure that waiting genuinely cures,
   * and on a shared host it is reached by other tenants' traffic as often as
   * by ours. Three goes at it spent three and a half seconds and gave up,
   * which is not waiting; it is a pause.
   */
  const ceiling = status === 429 ? LIMIT_ATTEMPTS : MAX_ATTEMPTS
  if (attempt >= ceiling) return null

  const asked = Number(retryAfter)
  const wait = Number.isFinite(asked) && asked > 0
    // Seconds, by the standard. Capped, because an explorer asking for five
    // minutes is asking for longer than a scan is allowed to take.
    ? Math.min(asked * 1000, MAX_BACKOFF_MS)
    : Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)

  /*
   * Never sleep past the budget. A wait that outlives the request it is
   * waiting for buys nothing: the function is killed mid-sleep and
   * everything already read is lost with it. Better to stop here, hand back
   * the pages we have, and say what stopped us.
   */
  return wait >= msLeft ? null : wait
}

/** Three goes at a page that errored; eight at one that was merely metered. */
const MAX_ATTEMPTS = 3
const LIMIT_ATTEMPTS = 8
const BASE_BACKOFF_MS = 1_200
const MAX_BACKOFF_MS = 10_000

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
  const who = chain === 'TRON' ? 'TronGrid' : 'the public explorer'
  /*
   * Waiting comes first, because waiting is the answer. The keyless sources
   * meter by the minute, not by the day: a scan that was turned away is
   * nearly always fine a minute later, and whatever it did read is kept, so
   * scanning again costs nothing and repeats nothing.
   */
  return `${who} is rate-limiting us — it meters by the minute, so scan again shortly and `
    + 'it will pick up where this left off. A free key below raises the ceiling if this keeps '
    + 'happening, but nothing here needs one.'
}

/**
 * Stopped by the clock, said as a state of play rather than a failure.
 *
 * Nothing is lost when this happens: a transfer is recognised by its own
 * content, so everything read is kept and scanning again picks up where this
 * one stopped instead of starting over.
 */
function outOfTime(chain: WalletChain): string {
  return `${EXPLORER[chain]} was still rate-limiting us when this scan ran out of time. `
    + 'Everything it did read has been kept — scan again in a minute to carry on from there.'
}

/** What to call each explorer when telling somebody it would not answer. */
const EXPLORER: Record<WalletChain, string> = {
  TRON: 'TronGrid (tronscan\u2019s own source)',
  ETHEREUM: 'Etherscan',
}

async function getJson(
  url: string, chain: WalletChain, headers: Record<string, string> = {},
  deadline = Infinity,
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

      const wait = waitFor(
        response.status, attempt, response.headers.get('retry-after'), deadline - Date.now(),
      )
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
    } catch (error) {
      // A sentence we chose already: leave it alone.
      if (error instanceof ChainError) throw error
      /*
       * A request that never got an answer at all — DNS, a refused or
       * dropped connection, or our own timeout firing. `fetch` reports every
       * one of these as "fetch failed", which told whoever was reconciling
       * invoices precisely nothing. It is also worth one more attempt: a
       * dropped connection is the most retryable failure there is.
       */
      const aborted = (error as { name?: string } | null)?.name === 'AbortError'
      const wait = waitFor(503, attempt, null, deadline - Date.now())
      if (wait === null) {
        throw new ChainError(
          aborted
            ? `${EXPLORER[chain]} did not answer within ${Math.round(TIMEOUT_MS / 1000)} seconds`
            : `${EXPLORER[chain]} could not be reached — check this deployment can make outbound requests to it`,
          chain,
        )
      }
      logger.info('the explorer did not answer; trying again', { chain, attempt, wait })
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
    // Out of time: hand back what was read rather than start a page that
    // will be killed half-way through.
    if (options.deadline && Date.now() > options.deadline) {
      return { transfers: found, stoppedBy: outOfTime('TRON') }
    }
    try {
    const url = new URL(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`)
    url.searchParams.set('contract_address', contract)
    url.searchParams.set('limit', String(Math.min(PAGE, limit - found.length)))
    url.searchParams.set('order_by', 'block_timestamp,desc')
    if (options.since) url.searchParams.set('min_timestamp', String(options.since.getTime()))
    if (fingerprint) url.searchParams.set('fingerprint', fingerprint)

    if (page > 0) await sleep(PAGE_PAUSE_MS)
    const body = await getJson(
      url.toString(), 'TRON', key ? { 'TRON-PRO-API-KEY': key } : {}, options.deadline,
    )
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
 * Ethereum, from whatever public source will answer without being paid.
 *
 * Alex: "I dont want it to use keys i just want it to look at the publicly
 * available information of transactions."
 *
 * That is the right instinct and it took a rewrite to honour, because
 * Etherscan stopped serving unkeyed requests when it moved to v2 — every
 * call needs a key now, free tier included. What it did not take away is the
 * data: an ERC-20 transfer is public, and Blockscout runs a public Ethereum
 * instance that serves the same query, in the same request shape, for
 * nobody's key at all.
 *
 * So the sources are tried in order and the keyless one goes first. A key,
 * if somebody has bothered with one, is a fallback that raises a ceiling —
 * never a requirement, and never the thing standing between a dealer and
 * their own payments.
 */
interface Source {
  name: string
  base: string
  /** Appended as `apikey` when we hold one. Never required to try. */
  usesKey: boolean
  /** Etherscan carries the chain in the query; a per-chain instance does not. */
  chainId?: string
}

export function ethereumSources(key: string | null): Source[] {
  const sources: Source[] = [{
    name: 'Blockscout',
    base: process.env.BLOCKSCOUT_API_URL?.trim() || 'https://eth.blockscout.com/api',
    usesKey: false,
  }]
  /*
   * Only when there is one. Listing Etherscan without a key would spend an
   * attempt — and a few seconds of somebody's scan — on a request we already
   * know it will refuse.
   */
  if (key) {
    sources.push({ name: 'Etherscan', base: etherscanBase(), usesKey: true, chainId: '1' })
  }
  return sources
}

async function fetchEthereum(address: string, options: FetchOptions): Promise<ChainRead> {
  const key = (await explorerKey('ETHEREUM')) ?? null
  const sources = ethereumSources(key)
  const refusals: string[] = []

  for (const source of sources) {
    try {
      return await fetchEtherscanShaped(source, address, options, key)
    } catch (error) {
      if (!(error instanceof ChainError)) throw error
      refusals.push(`${source.name}: ${error.message}`)
      logger.warn('a public source would not answer; trying the next', {
        source: source.name, message: error.message,
      })
    }
  }

  /*
   * Every source refused. Said in full rather than summarised: when two
   * public explorers both decline, which one said what is the only thing
   * that tells somebody whether to wait a minute or change something.
   */
  throw new ChainError(
    refusals.join(' · ') || 'no public source would answer',
    'ETHEREUM',
  )
}

/**
 * The Etherscan request shape, which Blockscout also speaks.
 *
 * One loop for both, because they genuinely are the same query — the same
 * `module=account&action=tokentx` with the same paging and the same row
 * shape. Writing it twice would be two things to keep in step for no gain.
 */
async function fetchEtherscanShaped(
  source: Source, address: string, options: FetchOptions, key: string | null,
): Promise<ChainRead> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const contract = USDT_CONTRACTS.ETHEREUM
  const found: ChainTransfer[] = []

  for (let page = 1; page <= MAX_PAGES && found.length < limit; page += 1) {
    if (options.deadline && Date.now() > options.deadline) {
      return { transfers: found, stoppedBy: outOfTime('ETHEREUM') }
    }
    try {
      const url = new URL(source.base)
      if (source.chainId) url.searchParams.set('chainid', source.chainId)
      url.searchParams.set('module', 'account')
      url.searchParams.set('action', 'tokentx')
      url.searchParams.set('contractaddress', contract)
      url.searchParams.set('address', address)
      url.searchParams.set('page', String(page))
      url.searchParams.set('offset', String(Math.min(PAGE, limit - found.length)))
      url.searchParams.set('sort', 'desc')
      if (source.usesKey && key) url.searchParams.set('apikey', key)

      if (page > 1) await sleep(PAGE_PAUSE_MS)
      const body = await getJson(url.toString(), 'ETHEREUM', {}, options.deadline)
      const answer = body as { status?: string; message?: string; result?: unknown }

      /*
       * "No transactions found" arrives as a failure status with an empty
       * result, which is not a failure: it is the answer for a wallet that
       * has not been paid yet, and treating it as an error would put a red
       * banner over a working scan.
       */
      if (answer.status !== '1') {
        const message = String(answer.message ?? '')
        if (/no transactions found|no records found/i.test(message)) break
        // Both answer 200 with the limit in the body, so the status-code
        // retry above never sees it.
        if (/rate limit|max calls per sec|too many/i.test(message)) {
          throw new ChainError(limitMessage('ETHEREUM'), 'ETHEREUM')
        }
        throw new ChainError(message || 'the request was refused', 'ETHEREUM')
      }

      const rows = Array.isArray(answer.result) ? answer.result : []
      for (const row of rows) {
        const transfer = readEtherscanRow(row)
        if (!transfer) continue
        // A source given a window it does not support returns everything
        // from the beginning, so the window is applied here as well.
        if (options.since && transfer.blockTime < options.since) continue
        found.push(transfer)
      }
      if (rows.length === 0) break
    } catch (error) {
      /*
       * Pages already read are kept, and only then is the next source tried
       * — but a partial read is returned rather than thrown, because what
       * arrived is real money that arrived.
       */
      if (found.length > 0 && error instanceof ChainError) {
        return { transfers: found, stoppedBy: `${source.name}: ${error.message}` }
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
