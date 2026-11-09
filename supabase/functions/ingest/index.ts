// Ingestão de PDFs (somente admin): cria o documento e grava os chunks.
// Os embeddings gte-small (384 dim) chegam prontos do navegador: gerá-los aqui estoura o
// limite de ~2 s de CPU por chamada do plano gratuito.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CATEGORIAS = ['IRPF', 'MEI', 'DIRF', 'Outros']
const MAX_CHUNKS = 20
const MAX_CONTEUDO = 1200
const DIMENSOES = 384

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Autenticação + papel admin
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Não autenticado' }, 401)
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData.user) return json({ error: 'Não autenticado' }, 401)
    const { data: isAdmin, error: roleErr } = await admin.rpc('has_role', { _user_id: userData.user.id, _role: 'admin' })
    if (roleErr) throw roleErr
    if (!isAdmin) return json({ error: 'Acesso negado' }, 403)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ error: 'JSON inválido' }, 400)

    if (body.acao === 'criar') {
      const { nome, categoria, total_paginas } = body
      if (typeof nome !== 'string' || !nome.trim() || nome.length > 255) return json({ error: 'nome inválido' }, 400)
      if (!CATEGORIAS.includes(categoria)) return json({ error: 'categoria inválida' }, 400)
      if (!Number.isInteger(total_paginas) || total_paginas < 1) return json({ error: 'total_paginas inválido' }, 400)

      // Mesmo nome: substitui (chunks saem junto pelo cascade).
      const { error: delErr } = await admin.from('documents').delete().eq('nome', nome.trim())
      if (delErr) throw delErr
      const { data, error } = await admin
        .from('documents')
        .insert({ nome: nome.trim(), categoria, total_paginas })
        .select('id')
        .single()
      if (error) throw error
      return json({ document_id: data.id })
    }

    if (body.acao === 'chunks') {
      const { document_id, chunks } = body
      if (typeof document_id !== 'string') return json({ error: 'document_id inválido' }, 400)
      if (!Array.isArray(chunks) || chunks.length === 0 || chunks.length > MAX_CHUNKS)
        return json({ error: `envie entre 1 e ${MAX_CHUNKS} chunks` }, 400)
      for (const c of chunks) {
        if (typeof c?.conteudo !== 'string' || !c.conteudo.trim() || c.conteudo.length > MAX_CONTEUDO)
          return json({ error: `conteudo deve ter entre 1 e ${MAX_CONTEUDO} caracteres` }, 400)
        if (!Number.isInteger(c.pagina) || c.pagina < 1) return json({ error: 'pagina inválida' }, 400)
        if (
          !Array.isArray(c.embedding) || c.embedding.length !== DIMENSOES ||
          !c.embedding.every((x: unknown) => typeof x === 'number' && Number.isFinite(x))
        )
          return json({ error: `embedding deve ter ${DIMENSOES} números` }, 400)
      }

      const rows = chunks.map((c: { conteudo: string; pagina: number; embedding: number[] }) => ({
        document_id,
        conteudo: c.conteudo,
        pagina: c.pagina,
        embedding: JSON.stringify(c.embedding),
      }))
      const { error } = await admin.from('chunks').insert(rows)
      if (error) throw error
      return json({ gravados: rows.length })
    }

    return json({ error: 'acao deve ser "criar" ou "chunks"' }, 400)
  } catch (e) {
    console.error('ingest error:', e)
    return json({ error: 'Erro ao processar o documento. Tente novamente.' }, 500)
  }
})
