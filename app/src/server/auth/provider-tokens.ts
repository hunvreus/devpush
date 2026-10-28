import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { config } from '#devpush/server/config'

// Better Auth's single-secret encryption format. Use the same key/codec as
// encryptOAuthTokens so refresh and reconnect never switch storage formats.
// Bare hex includes a 24-byte nonce and 16-byte authentication tag. Shorter
// hex strings cannot be encrypted envelopes.
function isEncrypted(value: string) {
  return (
    value.startsWith('$ba$') ||
    (value.length >= 80 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value))
  )
}

export async function readProviderToken(value: string) {
  return isEncrypted(value)
    ? symmetricDecrypt({ key: config.BETTER_AUTH_SECRET, data: value })
    : value
}

export async function storeProviderToken(value: string) {
  if (isEncrypted(value)) {
    await readProviderToken(value)
    return value
  }
  return symmetricEncrypt({ key: config.BETTER_AUTH_SECRET, data: value })
}
