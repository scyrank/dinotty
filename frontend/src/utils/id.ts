/**
 * Generate a UUID v4 string with fallback for non-secure contexts.
 * crypto.randomUUID() is only available in secure contexts (HTTPS, localhost).
 * This function falls back to crypto.getRandomValues() or Math.random().
 */
export function randomId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined

  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }

  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint8Array(16)
    c.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h: string[] = []
    for (let i = 0; i < 256; i++) h.push((i + 0x100).toString(16).slice(1))
    return (
      h[b[0]] +
      h[b[1]] +
      h[b[2]] +
      h[b[3]] +
      '-' +
      h[b[4]] +
      h[b[5]] +
      '-' +
      h[b[6]] +
      h[b[7]] +
      '-' +
      h[b[8]] +
      h[b[9]] +
      '-' +
      h[b[10]] +
      h[b[11]] +
      h[b[12]] +
      h[b[13]] +
      h[b[14]] +
      h[b[15]]
    )
  }

  // Fallback for environments without Web Crypto (in-session uniqueness only)
  let s = ''
  for (let i = 0; i < 32; i++) {
    const r = (Math.random() * 16) | 0
    const v = i === 12 ? 4 : i === 16 ? (r & 0x3) | 0x8 : r
    s += v.toString(16)
    if (i === 7 || i === 11 || i === 15 || i === 19) s += '-'
  }
  return s
}
