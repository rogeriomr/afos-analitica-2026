/**
 * Stable URL builders for external wallet/profile links.
 *
 * Each helper validates its input and returns null when malformed, so
 * callers can render a Link only when a real target exists (avoids
 * shipping broken https://polymarket.com/profile/undefined URLs).
 */

const ADDRESS_RE = /^0x[a-f0-9]{40}$/i
const TX_HASH_RE = /^0x[a-f0-9]{64}$/i

/**
 * Polymarket public profile URL for a proxy wallet address.
 * Returns null when `proxyAddress` is not a 0x-prefixed 40-hex address.
 */
export function polymarketProfileUrl(proxyAddress: string): string | null {
  if (!ADDRESS_RE.test(proxyAddress)) return null
  return `https://polymarket.com/profile/${proxyAddress.toLowerCase()}`
}

/**
 * Polygonscan address explorer URL.
 * Returns null when `proxyAddress` is not a 0x-prefixed 40-hex address.
 */
export function polygonscanAddressUrl(proxyAddress: string): string | null {
  if (!ADDRESS_RE.test(proxyAddress)) return null
  return `https://polygonscan.com/address/${proxyAddress.toLowerCase()}`
}

/**
 * Polygonscan transaction explorer URL.
 * Returns null when `txHash` is not a 0x-prefixed 64-hex hash.
 */
export function polygonscanTxUrl(txHash: string): string | null {
  if (!TX_HASH_RE.test(txHash)) return null
  return `https://polygonscan.com/tx/${txHash.toLowerCase()}`
}
