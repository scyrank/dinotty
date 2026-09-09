import { describe, expect, it } from 'vitest'
import { isSupportedOfficeBuffer } from '../composables/useOfficePreview'

function bytes(values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer
}

describe('Office preview container validation', () => {
  it('accepts ZIP-based Office documents', () => {
    expect(isSupportedOfficeBuffer(bytes([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true)
  })

  it('accepts legacy OLE Office documents', () => {
    expect(
      isSupportedOfficeBuffer(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]))
    ).toBe(true)
  })

  it('rejects a PDF even when its filename was classified as Office', () => {
    expect(isSupportedOfficeBuffer(bytes([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]))).toBe(
      false
    )
  })

  it('rejects arbitrary or truncated input', () => {
    expect(isSupportedOfficeBuffer(bytes([]))).toBe(false)
    expect(isSupportedOfficeBuffer(bytes([0x50, 0x4b]))).toBe(false)
    expect(isSupportedOfficeBuffer(bytes([0x00, 0x01, 0x02, 0x03]))).toBe(false)
  })
})
