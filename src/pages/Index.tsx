import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ChatInput } from '@/components/chat/ChatInput'
import { ChatMessage } from '@/components/chat/ChatMessage'
import type { Fonte, Mensagem } from '@/components/chat/types'
import { mensagemDeErro, supabase } from '@/integrations/supabase/client'

const EXEMPLOS = [
  'Quem está obrigado a declarar o Imposto de Renda?',
  'Qual o limite de faturamento anual do MEI?',
  'Como o MEI emite nota fiscal?',
  'Posso deduzir despesas médicas no IRPF?',
]

export default function Index() {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [carregando, setCarregando] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensagens, carregando])

  const perguntar = async (pergunta: string) => {
    if (carregando) return
    setMensagens((m) => [...m, { id: crypto.randomUUID(), role: 'user', content: pergunta }])
    setCarregando(true)
    try {
      const { data, error } = await supabase.functions.invoke<{ resposta: string; fontes: Fonte[] }>('chat', {
        body: { pergunta },
      })
      if (error) throw error
      if (!data) throw new Error('Resposta vazia')
      setMensagens((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', content: data.resposta, fontes: data.fontes },
      ])
    } catch (e) {
      toast.error(await mensagemDeErro(e))
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
          {carregando && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
              Consultando os documentos…
            </p>
          )}
        </section>
        <div ref={fimRef} />
      </main>

      <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-background via-background to-transparent pt-6">
        <div className="mx-auto w-full max-w-3xl px-4 pb-3">
          <ChatInput onSend={perguntar} disabled={carregando} />
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Respostas geradas por IA com base em documentos oficiais. Confirme no atendimento do NAF.
          </p>
        </div>
      </div>
    </div>
  )
}
