import { useState, type KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'

const MAX = 1000

export function ChatInput({ onSend, disabled }: { onSend: (texto: string) => void; disabled: boolean }) {
  const [texto, setTexto] = useState('')
  const vazio = texto.trim() === ''

  const enviar = () => {
    if (vazio || disabled) return
    onSend(texto.trim())
    setTexto('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); enviar() }}
      className="rounded-2xl bg-gradient-glow p-[2px] shadow-glow"
    >
      <div className="flex items-end gap-2 rounded-2xl bg-card px-3 py-2">
        <label htmlFor="pergunta" className="sr-only">Sua dúvida</label>
        <textarea
          id="pergunta"
          rows={1}
          maxLength={MAX}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Digite sua dúvida…"
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={vazio || disabled}
          aria-label="Enviar pergunta"
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </form>
  )
}
