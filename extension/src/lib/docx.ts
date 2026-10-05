// Minimal .docx reader: Google Docs' text export is unavailable for Word files opened in Docs,
// so we fetch the docx export and read word/document.xml ourselves (no dependencies).

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50

function findEntry(view: DataView, bytes: Uint8Array, name: string) {
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file')
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== CENTRAL) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const entryName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (entryName === name) return { method, compressedSize, localOffset }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return null
}

async function readEntry(buffer: ArrayBuffer, name: string): Promise<string | null> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const entry = findEntry(view, bytes, name)
  if (!entry) return null
  const nameLength = view.getUint16(entry.localOffset + 26, true)
  const extraLength = view.getUint16(entry.localOffset + 28, true)
  const start = entry.localOffset + 30 + nameLength + extraLength
  const data = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) throw new Error('Unsupported zip compression')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const TOKEN = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\s*\/>|<\/w:p>/g

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(parseInt(ref.slice(2), 16))
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10))
    return ENTITIES[ref]
  })
}

export function wordXmlToText(xml: string): string {
  let out = ''
  for (const match of xml.matchAll(TOKEN)) {
    if (match[1] !== undefined) out += decodeEntities(match[1])
    else if (match[0] === '</w:p>' || match[0].startsWith('<w:br') || match[0].startsWith('<w:cr')) out += '\n'
    else out += '\t'
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export async function docxToText(buffer: ArrayBuffer): Promise<string | null> {
  const xml = await readEntry(buffer, 'word/document.xml')
  return xml ? wordXmlToText(xml) : null
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
