import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { base64ToArrayBuffer, docxToText, wordXmlToText } from './docx'

function zip(files: Record<string, { data: Buffer; method: 0 | 8 }>): ArrayBuffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, { data, method }] of Object.entries(files)) {
    const body = method === 8 ? deflateRawSync(data) : data
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, body)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(nameBuf.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  const all = Buffer.concat([...parts, centralBuf, eocd])
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length)
}

const XML =
  '<w:document><w:body><w:p><w:r><w:t>3.2 The Seller will pay 90%</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> of S$1 &amp; more</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>[●] second</w:t></w:r></w:p></w:body></w:document>'

describe('docx text', () => {
  it('maps paragraphs, tabs and entities', () => {
    expect(wordXmlToText(XML)).toBe('3.2 The Seller will pay 90%\t of S$1 & more\n[●] second')
  })

  it('reads a deflated word/document.xml', async () => {
    const buf = zip({ '[Content_Types].xml': { data: Buffer.from('<x/>'), method: 8 }, 'word/document.xml': { data: Buffer.from(XML), method: 8 } })
    expect(await docxToText(buf)).toContain('3.2 The Seller will pay 90%')
  })

  it('reads a stored entry and returns null when missing', async () => {
    expect(await docxToText(zip({ 'word/document.xml': { data: Buffer.from(XML), method: 0 } }))).toContain('second')
    expect(await docxToText(zip({ 'other.xml': { data: Buffer.from('x'), method: 0 } }))).toBeNull()
  })

  it('round-trips a base64 docx like the in-tab fetch returns', async () => {
    const buf = Buffer.from(zip({ 'word/document.xml': { data: Buffer.from(XML), method: 8 } }))
    expect(await docxToText(base64ToArrayBuffer(buf.toString('base64')))).toContain('[●] second')
  })
})
