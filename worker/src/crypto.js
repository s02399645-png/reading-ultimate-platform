// Password hashing and token helpers — Web Crypto only (works in Workers and Node 20+).
const enc = new TextEncoder();

// Cloudflare Workers caps PBKDF2 at 100,000 iterations. To compensate, the password is first
// run through HMAC-SHA256 with a secret "pepper" that lives only in Worker secrets, so a stolen
// database alone cannot be brute-forced offline.
export const PBKDF2_ITERATIONS = 100000;

const toB64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toB64Url = (buf) => toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const toHex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

async function derive(password, salt, iterations, pepper) {
  const pre = await hmac(pepper, password);
  const key = await crypto.subtle.importKey('raw', pre, 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export function timingSafeEqual(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : new Uint8Array(a);
  const y = typeof b === 'string' ? enc.encode(b) : new Uint8Array(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export async function hashPassword(password, pepper, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, iterations, pepper);
  return `pbkdf2$sha256$${iterations}$${toB64(salt)}$${toB64(bits)}`;
}

export async function verifyPassword(password, stored, pepper) {
  const parts = String(stored).split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[2], 10);
  if (!iterations || iterations > PBKDF2_ITERATIONS) return false;
  const bits = await derive(password, fromB64(parts[3]), iterations, pepper);
  return timingSafeEqual(bits, fromB64(parts[4]));
}

// 256 random bits; only the SHA-256 of this value is stored in D1.
export function newToken() { return toB64Url(crypto.getRandomValues(new Uint8Array(32))); }
export async function sha256Hex(text) { return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

// Readable temporary password (no look-alike characters) for teacher resets.
export function tempPassword(len = 12) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(len));
  return [...r].map((x) => chars[x % chars.length]).join('');
}
