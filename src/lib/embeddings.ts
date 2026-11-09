// Embeddings dos chunks gerados no navegador do admin: o plano gratuito do Supabase limita
// cada Edge Function a ~2 s de CPU, insuficiente para lotes de embeddings.
// Mesmo modelo do Supabase.ai usado pela função chat (gte-small, 384 dim, mean pool + normalize).
import { pipeline } from '@huggingface/transformers'

export const DIMENSOES = 384

type Extractor = (textos: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>

let extractor: Promise<Extractor> | null = null

export function carregarModelo(): Promise<Extractor> {
  extractor ??= (pipeline('feature-extraction', 'Supabase/gte-small') as unknown as Promise<Extractor>).catch((e) => {
    extractor = null // permite tentar de novo
    throw e
  })
  return extractor
}

export async function gerarEmbeddings(textos: string[]): Promise<number[][]> {
  const ext = await carregarModelo()
  const vetores = (await ext(textos, { pooling: 'mean', normalize: true })).tolist()
  if (vetores.some((v) => v.length !== DIMENSOES)) throw new Error(`Embedding com dimensão diferente de ${DIMENSOES}`)
  return vetores
}
