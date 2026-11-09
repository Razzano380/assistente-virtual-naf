export type Categoria = 'IRPF' | 'MEI' | 'DIRF' | 'Outros'

export interface Fonte { nome: string; pagina: number; categoria: Categoria; similaridade: number }

export interface Mensagem {
  id: string
  role: 'user' | 'assistant'
  content: string
  fontes?: Fonte[]
}
