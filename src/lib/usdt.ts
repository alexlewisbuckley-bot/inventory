import { USDT_DECIMALS, type WalletChain } from './enums'

/**
 * The arithmetic of a token amount, kept away from the network code.
 *
 * A chain stores money as an integer of the smallest unit — USDT has six
 * decimals, so 126,519 USDT arrives as the string "126519000000". Every bug
 * in this area is a rounding one, so the conversion happens once, here, where
 * it can be tested without a network call.
 */

/** Cents from the chain's integer. Returns null for anything that is not one. */
export function usdFromRaw(raw: string, decimals: number = USDT_DECIMALS): number | null {
  const digits = raw.trim()
  if (!/^\d+$/.test(digits)) return null
  if (decimals < 2 || decimals > 30) return null

  /*
   * Through BigInt rather than Number.
   *
   * A 256-bit integer does not fit in a double, and a payment of
   * 9,007,199,254.740993 USDT is not a number this is allowed to round. The
   * division to cents is integer division with an explicit rounding step, so
   * a half-cent goes the same way every time rather than wherever the
   * floating point lands.
   */
  const value = BigInt(digits)
  const toCents = BigInt(10) ** BigInt(decimals - 2)
  const whole = value / toCents
  const remainder = value % toCents
  // Round half up, which is what a person doing it on paper does.
  const rounded = remainder * BigInt(2) >= toCents ? whole + BigInt(1) : whole

  // Anything past this is not a payment, it is a token with a silly supply.
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(rounded)
}

/** What the chain's integer would be for a figure in cents. */
export function rawFromUsd(cents: number, decimals: number = USDT_DECIMALS): string {
  const scale = BigInt(10) ** BigInt(decimals - 2)
  return (BigInt(Math.round(cents)) * scale).toString()
}

/**
 * Whether an address is the right shape for its chain.
 *
 * Shape only — whether it exists is the chain's business, and a wallet typed
 * in wrongly is caught by its first scan returning nothing. What this stops
 * is an Ethereum address saved as a TRON wallet, which would otherwise scan
 * clean for ever and quietly account for none of the money.
 */
export function validAddress(chain: WalletChain, address: string): boolean {
  const value = address.trim()
  if (chain === 'TRON') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

/**
 * The form an address is stored and compared in.
 *
 * Ethereum addresses are case-insensitive and arrive in four capitalisations
 * — a checksummed one from a wallet, a lower-cased one from an explorer, an
 * upper-cased one from somebody's spreadsheet. Stored as they compare, or the
 * same wallet is two wallets and half the payments never match.
 *
 * TRON base58 is case-sensitive and is left exactly as it is.
 */
export function normaliseAddress(chain: WalletChain, address: string): string {
  const value = address.trim()
  return chain === 'ETHEREUM' ? value.toLowerCase() : value
}

/** The short form for a screen: enough to recognise, not enough to retype. */
export function shortAddress(address: string): string {
  if (address.length <= 14) return address
  return `${address.slice(0, 6)}…${address.slice(-6)}`
}

/** USDT in cents, as a desk would write it. */
export function formatUsdt(cents: number): string {
  return `${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`
}
