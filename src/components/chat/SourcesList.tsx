import { useState } from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { Categoria, Fonte } from './types'

const corCategoria: Record<Categoria, string> = {
  IRPF: 'border-cat-irpf/50 bg-cat-irpf/15 text-cat-irpf',
  MEI: 'border-cat-mei/50 bg-cat-mei/15 text-cat-mei',
  DIRF: 'border-cat-dirf/50 bg-cat-dirf/15 text-cat-dirf',
  Outros: 'border-cat-outros/50 bg-cat-outros/15 text-cat-outros',
}

export function SourcesList({ fontes }: { fontes: Fonte[] }) {
  const [aberto, setAberto] = useState(false)
  if (fontes.length === 0) return null

  return (
    <Collapsible open={aberto} onOpenChange={setAberto} className="mt-3 border-t border-border pt-2">
      <CollapsibleTrigger className="flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown className={cn('h-4 w-4 transition-transform', aberto && 'rotate-180')} aria-hidden />
        Fontes ({fontes.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 flex flex-wrap gap-2">
          {fontes.map((f) => (
            <li
              key={`${f.nome}-${f.pagina}`}
              title={`${f.categoria} · similaridade ${(f.similaridade * 100).toFixed(0)}%`}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                corCategoria[f.categoria] ?? corCategoria.Outros,
              )}
            >
              <FileText className="h-3 w-3" aria-hidden />
              {f.nome} • pág. {f.pagina}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
