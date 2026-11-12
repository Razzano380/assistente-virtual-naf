// Teste de ponta a ponta: manda as perguntas do gabarito à função chat PUBLICADA e confere se a página
// esperada está nas fontes (e se as perguntas fora da base recebem "Não encontrei").
// Gasta cota da Groq e respeita o limite de 20 perguntas a cada 10 min: espera 32 s entre perguntas (~40 min).
// Uso: npm run avaliar:chat            (todas)   ·   npm run avaliar:chat -- 10   (só as 10 primeiras)
// Retoma de onde parou: as respostas ficam em scripts/.cache/chat.json (apague para recomeçar).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gerarEmbeddings } from '../src/lib/embeddings.ts'

const ESPERA = 32_000
const DOCS = { irpf: 'P&R IRPF', dirf: 'Dirf', mei: 'perguntaS_mei', gov: 'gov_MEI' }
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const URL_CHAT = `${env.VITE_SUPABASE_URL}/functions/v1/chat`
const CHAVE = env.VITE_SUPABASE_PUBLISHABLE_KEY // pública por definição
const { perguntas } = JSON.parse(readFileSync(new URL('./gabarito.json', import.meta.url), 'utf8'))
const limite = Number(process.argv[2]) || perguntas.length
const arq = new URL('./.cache/chat.json', import.meta.url)
mkdirSync(new URL('./.cache/', import.meta.url), { recursive: true })
const feitas = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const p of perguntas.slice(0, limite)) {
  if (feitas[p.pergunta]) continue
  const [embedding] = await gerarEmbeddings([p.pergunta], 'query')
  let r
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const res = await fetch(URL_CHAT, {
      method: 'POST',
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pergunta: p.pergunta, embedding }),
    })
    r = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (res.status !== 429) break
    console.log('   (limite atingido, esperando 2 min)')
    await sleep(120_000)
  }
  // Erro (limite da Groq etc.) não é resposta: não guarda, para a próxima execução tentar de novo.
  if (!r.error) {
    feitas[p.pergunta] = r
    writeFileSync(arq, JSON.stringify(feitas, null, 1))
  }
  console.log(`${p.doc ?? 'fora'}  ${p.pergunta}  →  ${(r.resposta ?? r.error ?? '').replace(/\s+/g, ' ').slice(0, 70)}`)
  await sleep(ESPERA)
}

let ok = 0, n = 0
const falhas = []
for (const p of perguntas.slice(0, limite)) {
  const r = feitas[p.pergunta]
  if (!r) continue
  n++
  const naoAchou = !r.resposta || r.resposta.startsWith('Não encontrei')
  const aceitas = [{ doc: p.doc, pagina: p.pagina }, ...(p.outras ?? [])]
  const certo = p.doc
    ? !naoAchou && (r.fontes ?? []).some((f) => aceitas.some((a) => f.nome.includes(DOCS[a.doc]) && f.pagina >= a.pagina && f.pagina <= a.pagina + 1))
    : naoAchou
  if (certo) ok++
  else falhas.push(`${p.pergunta} (esperado ${p.doc ? `${p.doc} p${p.pagina}` : '"Não encontrei"'}; veio ${naoAchou ? '"Não encontrei"' : (r.fontes ?? []).map((f) => `${f.nome.slice(0, 12)} p${f.pagina}`).join(', ') || r.error})`)
}
console.log(`\n== Ponta a ponta: ${ok}/${n} certas (página esperada nas fontes; fora da base → "Não encontrei")`)
for (const f of falhas) console.log('   ✗ ' + f)
