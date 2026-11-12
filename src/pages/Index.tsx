import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ChatInput } from '@/components/chat/ChatInput'
import { ChatMessage } from '@/components/chat/ChatMessage'
import type { Fonte, Mensagem } from '@/components/chat/types'
import { mensagemDeErro } from '@/integrations/supabase/client'

const CATEGORIAS = ['IRPF', 'MEI', 'DIRF'] as const

const EXEMPLOS = [
  'Quem está obrigado a declarar o Imposto de Renda?',
  'Qual o limite de faturamento anual do MEI?',
  'Como o MEI emite nota fiscal?',
  'Posso deduzir despesas médicas no IRPF?',
]

// Import dinâmico: o modelo (~113 MB, fica em cache no navegador) não atrasa a primeira tela.
const embeddings = () => import('@/lib/embeddings')

export default function Index() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [carregando, setCarregando] = useState(false)
  const [modeloPronto, setModeloPronto] = useState(false)
  const [categoria, setCategoria] = useState<(typeof CATEGORIAS)[number] | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Começa a baixar o modelo ao abrir a página, para a primeira pergunta não esperar o download.
    embeddings()
      .then((m) => m.carregarModelo())
      .then(() => setModeloPronto(true))
      .catch(() => {}) // a falha reaparece, com mensagem, ao perguntar
  }, [])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensagens, carregando])

  const perguntar = async (pergunta: string) => {
    if (carregando) return
    // Pergunta curta ("e se eu atrasar?") só faz sentido com a anterior: a busca usa as duas.
    const anterior = [...mensagens].reverse().find((m) => m.role === 'user')?.content
    const busca = anterior && pergunta.split(/\s+/).length < 8 ? `${anterior} ${pergunta}` : pergunta
    const historico = mensagens.slice(-6).map(({ role, content }) => ({ role, content }))
    setMensagens((m) => [...m, { id: crypto.randomUUID(), role: 'user', content: pergunta }])
    setCarregando(true)
    try {
      const [embedding] = await (await embeddings()).gerarEmbeddings([busca], 'query')
      setModeloPronto(true)
      const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta, busca, embedding, categoria, historico, stream: true }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `A função respondeu com erro ${res.status}.`)

      // Resposta em SSE: {delta} vai montando o texto; {fim} traz o texto final limpo e as fontes.
      const id = crypto.randomUUID()
      const atualizar = (p: Partial<Mensagem>) =>
        setMensagens((m) =>
          m.some((x) => x.id === id) ? m.map((x) => (x.id === id ? { ...x, ...p } : x)) : [...m, { id, role: 'assistant', content: '', ...p }],
        )
      if (res.headers.get('content-type')?.includes('application/json')) {
        const r = (await res.json()) as { resposta: string; fontes: Fonte[] }
        atualizar({ content: r.resposta, fontes: r.fontes })
        return
      }
      const leitor = res.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buf = '', texto = ''
      for (;;) {
        const { done, value } = await leitor.read()
        if (done) break
        buf += value
        const blocos = buf.split('\n\n')
        buf = blocos.pop()!
        for (const b of blocos) {
          const ev = JSON.parse(b.replace(/^data: /, '')) as { delta?: string; fim?: boolean; resposta?: string; fontes?: Fonte[]; error?: string }
          if (ev.error) throw new Error(ev.error)
          if (ev.delta) { texto += ev.delta; atualizar({ content: texto }) }
          if (ev.fim) atualizar({ content: ev.resposta ?? texto, fontes: ev.fontes })
        }
      }
    } catch (e) {
      toast.error(e instanceof TypeError ? 'Não foi possível conectar ao servidor.' : await mensagemDeErro(e))
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-44 pt-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-primary sm:text-4xl">
              <span aria-hidden>⚖️ </span>Assistente Virtual NAF
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Tire suas dúvidas sobre Imposto de Renda, MEI e DIRF com base nos documentos oficiais da Receita
              Federal.
            </p>
          </div>
          {mensagens.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setMensagens([])} disabled={carregando}>
              <RotateCcw className="mr-1 h-4 w-4" aria-hidden /> Nova conversa
            </Button>
          )}
        </header>

        {mensagens.length === 0 && !carregando && (
          <section aria-label="Perguntas de exemplo" className="flex flex-wrap gap-2">
            {EXEMPLOS.map((ex) => (
              <button
                key={ex}
                onClick={() => perguntar(ex)}
                className="rounded-full border border-primary/40 bg-secondary px-4 py-2 text-left text-sm text-foreground transition hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ex}
              </button>
            ))}
          </section>
        )}

        <section aria-live="polite" aria-label="Conversa" className="flex flex-col gap-4">
          {mensagens.map((m) => (
            <ChatMessage key={m.id} mensagem={m} />
          ))}
          {carregando && mensagens[mensagens.length - 1]?.role === 'user' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
              {modeloPronto
                ? 'Consultando os documentos…'
                : 'Preparando o modelo de busca (~113 MB, só na primeira visita)…'}
            </p>
          )}
        </section>
        <div ref={fimRef} />
      </main>

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-background via-background to-transparent pt-6">
        <div className="mx-auto w-full max-w-3xl px-4 pb-3">
          <div role="group" aria-label="Buscar em" className="mb-2 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Buscar em:</span>
            {[null, ...CATEGORIAS].map((c) => (
              <button
                key={c ?? 'todas'}
                type="button"
                aria-pressed={categoria === c}
                onClick={() => setCategoria(c)}
                className={`rounded-full border px-3 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  categoria === c ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/40 bg-secondary hover:border-primary'
                }`}
              >
                {c ?? 'Todas'}
              </button>
            ))}
          </div>
          <ChatInput onSend={perguntar} disabled={carregando} />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Respostas geradas por IA com base em documentos oficiais. Confirme no atendimento do NAF.
          </p>
        </div>
      </div>
    </div>
  )
}
