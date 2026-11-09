import { createClient } from '@supabase/supabase-js'

// Só a chave pública (anon/publishable). A GROQ_API_KEY fica nos Secrets das Edge Functions.
const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

export const supabaseConfigurado = Boolean(url && key)
if (!supabaseConfigurado) console.error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env')

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
})

/** Extrai a mensagem de erro devolvida pela Edge Function (corpo { error }). */
export async function mensagemDeErro(error: unknown): Promise<string> {
  if (!supabaseConfigurado) return 'Supabase não configurado: preencha VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env e reinicie o npm run dev.'
  if ((error as { name?: string })?.name === 'FunctionsFetchError')
    return 'Não foi possível conectar ao servidor. Verifique se as Edge Functions foram publicadas no Supabase.'
  const ctx = (error as { context?: Response })?.context
  if (ctx && typeof ctx.json === 'function') {
    if (ctx.status === 546) return 'A função excedeu o limite de CPU do Supabase (erro 546).'
    try {
      const body = await ctx.clone().json()
      if (body?.error) return body.error
      if (body?.message) return `${body.message} (erro ${ctx.status})`
    } catch { /* corpo não-JSON */ }
    return `A função respondeu com erro ${ctx.status}.`
  }
  return error instanceof Error ? error.message : 'Erro inesperado'
}
