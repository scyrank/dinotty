import { describe, expect, it } from 'vitest'
import { safeThemeColor } from '../composables/useTabPreview'

describe('terminal preview theme color hardening', () => {
  it.each(['#abc', '#abcd', '#aabbcc', '#aabbccdd'])(
    'allows a normalized hexadecimal color: %s',
    (color) => {
      expect(safeThemeColor(color, '#000000')).toBe(color)
    },
  )

  it.each([
    'red',
    'rgb(1, 2, 3)',
    '#12345',
    '#1234567',
    'red" onmouseover="alert(1)',
    '#fff;background:url(https://attacker.invalid)',
  ])('rejects a color value that could escape the preview style: %s', (color) => {
    expect(safeThemeColor(color, '#abb2bf')).toBe('#abb2bf')
  })
})
