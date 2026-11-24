const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return fromBase64(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

async function deriveAesKey(passphrase: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(passphrase));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function deriveHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export async function encryptSecret(plaintext: string, passphrase: string): Promise<string> {
  const key = await deriveAesKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipherBuf))}`;
}

export async function decryptSecret(ciphertext: string, passphrase: string): Promise<string> {
  const [ivB64, dataB64] = ciphertext.split('.');
  if (!ivB64 || !dataB64) {
    throw new Error('Malformed encrypted token');
  }
  const key = await deriveAesKey(passphrase);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64) },
    key,
    fromBase64(dataB64)
  );
  return decoder.decode(plainBuf);
}

export async function signSession(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 7
): Promise<string> {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedBody = toBase64Url(encoder.encode(JSON.stringify(body)));
  const key = await deriveHmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedBody));
  return `${encodedBody}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifySession<T extends Record<string, unknown>>(
  token: string,
  secret: string
): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedBody, sigB64] = parts;
  if (!encodedBody || !sigB64) return null;

  try {
    const key = await deriveHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sigB64),
      encoder.encode(encodedBody)
    );
    if (!valid) return null;

    const parsed = JSON.parse(decoder.decode(fromBase64Url(encodedBody))) as T & { exp?: number };
    if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
