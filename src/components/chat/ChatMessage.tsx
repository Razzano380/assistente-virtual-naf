import ReactMarkdown from 'react-markdown'
import { Scale, User } from 'lucide-react'
import { SourcesList } from './SourcesList'
import type { Mensagem } from './types'

export function ChatMessage({ mensagem }: { mensagem: Mensagem }) {
  const isUser = mensagem.role === 'user'
  return (
    <article
      aria-label={isUser ? 'Sua pergunta' : 'Resposta do assistente'}
      className="flex gap-3 rounded-xl border-l-4 border-primary bg-card p-4 shadow-sm"
    >
      <div
        aria-hidden
        className={
          isUser
            ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground'
            : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow'
        }
      >
        {isUser ? <User className="h-5 w-5" /> : <Scale className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{mensagem.content}</p>
        ) : (
          <div className="prose-chat break-words">
            {/* Links abrem em nova aba para não perder a conversa. */}
            <ReactMarkdown components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" className="text-primary underline" /> }}>
              {mensagem.content}
            </ReactMarkdown>
          </div>
        )}
        {!isUser && mensagem.fontes && <SourcesList fontes={mensagem.fontes} />}
      </div>
    </article>
  )
}
