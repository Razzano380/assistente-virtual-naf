// Avalia a BUSCA do chat (sem a Groq, sem custo): para cada pergunta do gabarito, a página certa
// aparece entre os K trechos que vão para a IA? Usa o mesmo corte (chunkDocumento) e o mesmo
// modelo (gerarEmbeddings) do app. Uso: npm run avaliar -- "<pasta com os PDFs>"
// Requer Node 22.18+ (lê os .ts do app direto). Os vetores dos PDFs ficam em cache em scripts/.cache.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { chunkDocumento } from '../src/lib/chunker.ts'
import { MODELO, gerarEmbeddings } from '../src/lib/embeddings.ts'

const K = 6 // igual ao chat (supabase/functions/chat)
const TOLERANCIA = 1 // a resposta pode continuar na página seguinte à da pergunta
const DOCS = { irpf: 'P&R IRPF', dirf: 'Dirf', mei: 'perguntaS_mei', gov: 'gov_MEI' }

const pasta = process.argv[2] ?? process.env.NAF_PDFS
if (!pasta || !existsSync(pasta)) {
  console.error('Informe a pasta dos PDFs: npm run avaliar -- "C:/caminho/Perguntas mais frequentes"')
  process.exit(1)
}
const arquivos = readdirSync(pasta).filter((f) => f.toLowerCase().endsWith('.pdf'))
const { perguntas } = JSON.parse(readFileSync(new URL('./gabarito.json', import.meta.url), 'utf8'))

// Cache invalida sozinho se mudar o divisor, o modelo ou os PDFs.
const raiz = new URL('..', import.meta.url)
const assinatura = createHash('sha256')
  .update(readFileSync(new URL('src/lib/chunker.ts', raiz)))
  .update(MODELO)
  .update(arquivos.map((f) => f + readFileSync(join(pasta, f)).length).join('|'))
  .digest('hex').slice(0, 16)
const dirCache = new URL('scripts/.cache/', raiz)
const arqCache = new URL(`base-${assinatura}.json`, dirCache)

let base
if (existsSync(arqCache)) {
  base = JSON.parse(readFileSync(arqCache, 'utf8'))
  console.log(`Base em cache: ${base.length} trechos.`)
} else {
  base = []
  for (const f of arquivos) {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(pasta, f))), verbosity: 0 }).promise
    const paginas = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const itens = (await (await pdf.getPage(n)).getTextContent()).items
      paginas.push({ pagina: n, texto: itens.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : '')).join('') })
    }
    const chunks = chunkDocumento(paginas)
    console.log(`${f}: ${chunks.length} trechos; gerando embeddings…`)
    for (let i = 0; i < chunks.length; i += 32) {
      const lote = chunks.slice(i, i + 32)
      const vetores = await gerarEmbeddings(lote.map((c) => c.conteudo), 'passage')
      lote.forEach((c, j) => base.push({ doc: f, pagina: c.pagina, conteudo: c.conteudo, v: vetores[j] }))
    }
  }
  mkdirSync(dirCache, { recursive: true })
  writeFileSync(arqCache, JSON.stringify(base))
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
const vetQ = await gerarEmbeddings(perguntas.map((p) => p.pergunta), 'query')
const porDoc = {}
const falhas = []
let somaRR = 0
let comResposta = 0

console.log(`\nPosição do trecho certo entre ${base.length} (✓ = entre os ${K} que vão para a IA)\n`)
perguntas.forEach((p, k) => {
  const ordem = base.map((c, i) => [dot(c.v, vetQ[k]), i]).sort((a, b) => b[0] - a[0])
  const [s1, i1] = ordem[0]
  if (!p.doc) {
    console.log(`   —   fora  ${p.pergunta}  (1º: ${s1.toFixed(3)} ${base[i1].doc.slice(0, 14)} p${base[i1].pagina})`)
    return
  }
  comResposta++
  const aceitas = [{ doc: p.doc, pagina: p.pagina }, ...(p.outras ?? [])]
  const certo = (c) => aceitas.some((a) => c.doc.includes(DOCS[a.doc]) && c.pagina >= a.pagina && c.pagina <= a.pagina + TOLERANCIA)
  const pos = ordem.findIndex(([, i]) => certo(base[i])) + 1
  const ok = pos >= 1 && pos <= K
  somaRR += pos ? 1 / pos : 0
  porDoc[p.doc] ??= { ok: 0, total: 0 }
  porDoc[p.doc].total++
  if (ok) porDoc[p.doc].ok++
  else falhas.push({ ...p, pos, primeiro: `${base[i1].doc.slice(0, 14)} p${base[i1].pagina}: ${base[i1].conteudo.replace(/\s+/g, ' ').slice(0, 80)}` })
  console.log(`${ok ? ' ✓ ' : ' ✗ '} ${String(pos || '-').padStart(4)}  ${p.doc.padEnd(4)}  ${p.pergunta}`)
})

const total = Object.values(porDoc).reduce((s, d) => s + d.ok, 0)
console.log(`\n== Resultado: ${total}/${comResposta} (${Math.round((100 * total) / comResposta)}%) com a página certa entre os ${K} trechos`)
for (const [d, r] of Object.entries(porDoc)) console.log(`   ${d.padEnd(4)} ${r.ok}/${r.total}`)
console.log(`   MRR (posição média inversa): ${(somaRR / comResposta).toFixed(3)}`)
if (falhas.length) {
  console.log('\n== Fora dos 6 (o chat provavelmente erra ou diz que não encontrou):')
  for (const f of falhas) console.log(`   [${f.pos || 'não achou'}] ${f.pergunta}\n        esperado ${f.doc} p${f.pagina} · 1º veio ${f.primeiro}`)
}
