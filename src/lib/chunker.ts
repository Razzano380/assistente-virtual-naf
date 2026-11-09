// Port do RecursiveCharacterTextSplitter do LangChain (keep_separator=true, strip_whitespace=true).

export const CHUNK_SIZE = 1000
export const CHUNK_OVERLAP = 200
export const SEPARATORS = ['\n\n', '\n', ' ', '']

export interface SplitterOptions {
  chunkSize?: number
  chunkOverlap?: number
  separators?: string[]
}

export function splitText(text: string, opts: SplitterOptions = {}): string[] {
  const chunkSize = opts.chunkSize ?? CHUNK_SIZE
  const chunkOverlap = opts.chunkOverlap ?? CHUNK_OVERLAP
  if (chunkOverlap >= chunkSize) throw new Error('chunkOverlap deve ser menor que chunkSize')

  const mergeSplits = (splits: string[]): string[] => {
    const docs: string[] = []
    let current: string[] = []
    let total = 0
    for (const d of splits) {
      if (total + d.length > chunkSize && current.length > 0) {
        const doc = current.join('').trim()
        if (doc) docs.push(doc)
        // Mantém no início do próximo chunk até `chunkOverlap` caracteres do anterior.
        while (total > chunkOverlap || (total + d.length > chunkSize && total > 0)) {
          total -= current[0].length
          current = current.slice(1)
        }
      }
      current.push(d)
      total += d.length
    }
    const doc = current.join('').trim()
    if (doc) docs.push(doc)
    return docs
  }

  const split = (t: string, separators: string[]): string[] => {
    let separator = separators[separators.length - 1]
    let next: string[] = []
    for (let i = 0; i < separators.length; i++) {
      const s = separators[i]
      if (s === '') { separator = s; break }
      if (t.includes(s)) { separator = s; next = separators.slice(i + 1); break }
    }

    let pieces: string[]
    if (separator === '') {
      pieces = Array.from(t)
    } else {
      // keep_separator: o separador fica no início do pedaço seguinte.
      const parts = t.split(separator)
      pieces = [parts[0], ...parts.slice(1).map((p) => separator + p)]
    }
    pieces = pieces.filter((p) => p !== '')

    const final: string[] = []
    let good: string[] = []
    for (const p of pieces) {
      if (p.length < chunkSize) {
        good.push(p)
      } else {
        if (good.length) { final.push(...mergeSplits(good)); good = [] }
        if (next.length === 0) final.push(p.trim())
        else final.push(...split(p, next))
      }
    }
    if (good.length) final.push(...mergeSplits(good))
    return final
  }

  return split(text, opts.separators ?? SEPARATORS).filter(Boolean)
}

export interface Chunk { conteudo: string; pagina: number }

/** Divide página a página para que cada chunk saiba de qual página veio. */
export function chunkPages(pages: { pagina: number; texto: string }[], opts?: SplitterOptions): Chunk[] {
  return pages.flatMap(({ pagina, texto }) => splitText(texto, opts).map((conteudo) => ({ conteudo, pagina })))
}
