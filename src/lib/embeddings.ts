// Embeddings gerados no navegador (trechos no /admin e pergunta no chat).
// multilingual-e5-small: o gte-small, treinado em inglês, não achava respostas óbvias em português
// (ex.: "O que é MEI?"). O plano gratuito do Supabase não roda este modelo na Edge Function.
import { pipeline } from '@huggingface/transformers'

export const DIMENSOES = 384
export const MODELO = 'Xenova/multilingual-e5-small'

type Extractor = (textos: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>

let extractor: Promise<Extractor> | null = null

export function carregarModelo(): Promise<Extractor> {
  extractor ??= (pipeline('feature-extraction', MODELO, { dtype: 'q8' }) as unknown as Promise<Extractor>).catch((e) => {
    extractor = null // permite tentar de novo
    throw e
  })
  return extractor
}

/** O e5 exige o prefixo "query: " na pergunta e "passage: " nos trechos. */
export async function gerarEmbeddings(textos: string[], tipo: 'query' | 'passage'): Promise<number[][]> {
  const ext = await carregarModelo()
  const vetores = (await ext(textos.map((t) => `${tipo}: ${t}`), { pooling: 'mean', normalize: true })).tolist()
  if (vetores.some((v) => v.length !== DIMENSOES)) throw new Error(`Embedding com dimensão diferente de ${DIMENSOES}`)
  return vetores
}
