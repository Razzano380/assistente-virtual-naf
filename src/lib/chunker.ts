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

// Início de pergunta numerada no começo da linha: "001 — " (P&R IRPF) ou "1.8. " / "16.1 " (Dirf, P&R MEI).
const MARCA_PERGUNTA = /(?:^|\n)[ \t]*(?:\d{3} — |\d{1,2}\.\d{1,2}\.? +(?=\S))/g
const MIN_PERGUNTAS = 10

/**
 * Um bloco por pergunta: cada trecho começa com o título da pergunta, para a busca casar
 * a dúvida com o título mesmo quando a resposta usa outras palavras. Sem perguntas numeradas,
 * usa o corte por tamanho (chunkPages).
 */
export function chunkDocumento(pages: { pagina: number; texto: string }[]): Chunk[] {
  let texto = ''
  const inicios: number[] = []
  for (const { texto: t } of pages) { inicios.push(texto.length); texto += t + '\n' }
  const marcas = [...texto.matchAll(MARCA_PERGUNTA)].map((m) => m.index! + (m[0].startsWith('\n') ? 1 : 0))
  if (marcas.length < MIN_PERGUNTAS) return chunkPages(pages)

  // shortcut: página = onde a pergunta começa; respostas que atravessam páginas citam só a primeira.
  const paginaEm = (pos: number) => {
    let i = 0
    while (i + 1 < inicios.length && inicios[i + 1] <= pos) i++
    return pages[i].pagina
  }
  // Texto antes da 1ª pergunta (capa, apresentação): corte por tamanho, página a página.
  const preambulo = chunkPages(pages.map((p, i) => ({ pagina: p.pagina, texto: texto.slice(inicios[i], Math.min(inicios[i] + p.texto.length, marcas[0])) })))

  const chunks: Chunk[] = []
  marcas.forEach((ini, k) => {
    const bloco = texto.slice(ini, marcas[k + 1] ?? texto.length).trim()
    if (/\.{5,}/.test(bloco)) return // linha do sumário ("1.8 Pergunta?.......12"): sem resposta
    const fim = bloco.indexOf('?')
    const titulo = (fim > 0 && fim < 300 ? bloco.slice(0, fim + 1) : bloco.split('\n')[0].slice(0, 300)).replace(/\s+/g, ' ')
    const corpo = bloco.slice(fim > 0 && fim < 300 ? fim + 1 : bloco.split('\n')[0].length).trim()
    const pagina = paginaEm(ini)
    if (!corpo) return
    splitText(corpo, { chunkSize: CHUNK_SIZE - titulo.length - 1 })
      .forEach((parte) => chunks.push({ conteudo: `${titulo}\n${parte}`, pagina }))
  })
  return [...preambulo.filter((c) => !/\.{5,}/.test(c.conteudo)), ...chunks]
}
