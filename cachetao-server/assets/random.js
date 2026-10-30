// Web Crypto is available in Node 24 and the bundled HTTPS Android asset origin.
export function randomInt(max) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 0x100000000) throw new Error('Intervalo inválido.');
  const value = new Uint32Array(1), limit = Math.floor(0x100000000 / max) * max;
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % max;
}
export function randomUUID() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
