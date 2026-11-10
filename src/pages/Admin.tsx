import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { ArrowLeft, Loader2, LogOut, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { chunkDocumento } from '@/lib/chunker'
import { extrairPaginas } from '@/lib/pdf'
import { carregarModelo, gerarEmbeddings } from '@/lib/embeddings'
import { mensagemDeErro, supabase } from '@/integrations/supabase/client'
import type { Categoria } from '@/components/chat/types'

const CATEGORIAS: Categoria[] = ['IRPF', 'MEI', 'DIRF', 'Outros']
const LOTE = 20
const TENTATIVAS = 3 // 1 + 2 novas tentativas

interface Doc {
  id: string
  nome: string
  categoria: Categoria
  total_paginas: number
  created_at: string
  chunks: { count: number }[]
}

interface Progresso { arquivo: string; etapa: string; pagina: number; totalPaginas: number; enviados: number; totalChunks: number }

async function invokeIngest<T>(body: Record<string, unknown>): Promise<T> {
  let ultimoErro: unknown
  for (let i = 0; i < TENTATIVAS; i++) {
    const { data, error } = await supabase.functions.invoke<T>('ingest', { body })
    if (!error && data) return data
    ultimoErro = error
    const status = (error as { context?: Response })?.context?.status
    if (status && status < 500) break // erro do cliente/permissão: não adianta repetir
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
  }
  throw new Error(await mensagemDeErro(ultimoErro))
}

// Cadastro desligado no Supabase (Auth → "Allow new users to sign up"): admins novos são convidados pelo painel.
function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [carregando, setCarregando] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setCarregando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setCarregando(false)
    if (error) toast.error(error.message)
  }

  return (
    <Card className="mx-auto mt-16 max-w-sm">
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Área de administração da base de conhecimento.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={enviar} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="senha">Senha</Label>
            <Input
              id="senha" type="password" required autoComplete="current-password"
              value={senha} onChange={(e) => setSenha(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={carregando}>
            {carregando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Entrar
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * Segundo fator (TOTP). Sem fator verificado: cadastra o app autenticador (QR code).
 * Com fator: pede o código de 6 dígitos. O banco (RLS) e a função ingest exigem a sessão aal2.
 */
function SegundoFator({ onVerificado }: { onVerificado: () => void }) {
  const [fatorId, setFatorId] = useState<string | null>(null)
  const [qr, setQr] = useState<{ svg: string; segredo: string } | null>(null)
  const [codigo, setCodigo] = useState('')
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return toast.error(error.message)
      const verificado = data.totp.find((f) => f.status === 'verified')
      if (verificado) return setFatorId(verificado.id)
      // Cadastro interrompido antes deixa fator "unverified": remove para começar de novo.
      for (const f of data.all.filter((f) => f.factor_type === 'totp' && f.status !== 'verified'))
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      const novo = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Autenticador NAF' })
      if (novo.error) return toast.error(novo.error.message)
      setFatorId(novo.data.id)
      setQr({ svg: novo.data.totp.qr_code, segredo: novo.data.totp.secret })
    })()
  }, [])

  const verificar = async (e: FormEvent) => {
    e.preventDefault()
    if (!fatorId) return
    setCarregando(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo.trim() })
    setCarregando(false)
    if (error) return toast.error('Código inválido ou expirado. Confira o relógio do celular e tente de novo.')
    toast.success(qr ? 'Verificação em duas etapas ativada.' : 'Código confirmado.')
    onVerificado()
  }

  return (
    <Card className="mx-auto mt-16 max-w-sm">
      <CardHeader>
        <CardTitle>{qr ? 'Ative a verificação em duas etapas' : 'Verificação em duas etapas'}</CardTitle>
        <CardDescription>
          {qr
            ? 'Escaneie o QR code com um app autenticador (Google Authenticator, Microsoft Authenticator, Authy…) e digite o código de 6 dígitos.'
            : 'Digite o código de 6 dígitos do seu app autenticador.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {qr && (
          <div className="space-y-2 text-center">
            <img src={qr.svg} alt="QR code para cadastrar o app autenticador" className="mx-auto h-48 w-48 rounded bg-white p-2" />
            <p className="text-xs text-muted-foreground">
              Sem câmera? Digite a chave no app: <code className="break-all">{qr.segredo}</code>
            </p>
          </div>
        )}
        {!fatorId ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" aria-label="Carregando" />
        ) : (
          <form onSubmit={verificar} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="codigo">Código</Label>
              <Input
                id="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
                value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <Button type="submit" className="w-full" disabled={carregando || codigo.length !== 6}>
              {carregando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Confirmar
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function BaseDeConhecimento() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [carregandoDocs, setCarregandoDocs] = useState(true)
  const [arquivos, setArquivos] = useState<File[]>([])
  const [categoria, setCategoria] = useState<Categoria>('IRPF')
  const [progresso, setProgresso] = useState<Progresso | null>(null)

  const carregarDocs = useCallback(async () => {
    const { data, error } = await supabase
      .from('documents')
      .select('id, nome, categoria, total_paginas, created_at, chunks(count)')
      .order('created_at', { ascending: false })
    if (error) toast.error(error.message)
    else setDocs((data ?? []) as Doc[])
    setCarregandoDocs(false)
  }, [])

  useEffect(() => { carregarDocs() }, [carregarDocs])

  const processar = async () => {
    for (const file of arquivos) {
      try {
        setProgresso({ arquivo: file.name, etapa: 'Lendo PDF', pagina: 0, totalPaginas: 0, enviados: 0, totalChunks: 0 })
        const paginas = await extrairPaginas(file, (pagina, totalPaginas) =>
          setProgresso((p) => p && { ...p, pagina, totalPaginas }),
        )
        const chunks = chunkDocumento(paginas)
        if (chunks.length === 0) throw new Error('Nenhum texto encontrado (PDF escaneado?)')

        const { document_id } = await invokeIngest<{ document_id: string }>({
          acao: 'criar', nome: file.name, categoria, total_paginas: paginas.length,
        })

        setProgresso((p) => p && { ...p, etapa: 'Carregando o modelo de embeddings (~113 MB na 1ª vez)', totalChunks: chunks.length })
        await carregarModelo()
        setProgresso((p) => p && { ...p, etapa: 'Gerando embeddings e enviando' })
        for (let i = 0; i < chunks.length; i += LOTE) {
          const lote = chunks.slice(i, i + LOTE)
          const vetores = await gerarEmbeddings(lote.map((c) => c.conteudo), 'passage')
          await invokeIngest({
            acao: 'chunks',
            document_id,
            chunks: lote.map((c, j) => ({ ...c, embedding: vetores[j] })),
          })
          setProgresso((p) => p && { ...p, enviados: i + lote.length, pagina: lote[lote.length - 1].pagina })
        }
        toast.success(`${file.name}: ${chunks.length} chunks indexados`)
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : 'falha no processamento'}`)
      }
    }
    setProgresso(null)
    setArquivos([])
    carregarDocs()
  }

  const excluir = async (doc: Doc) => {
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    if (error) return toast.error(error.message)
    toast.success(`${doc.nome} excluído`)
    carregarDocs()
  }

  const pct = progresso?.totalChunks
    ? (progresso.enviados / progresso.totalChunks) * 100
    : progresso?.totalPaginas ? (progresso.pagina / progresso.totalPaginas) * 100 : 0

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Adicionar PDFs</CardTitle>
          <CardDescription>
            Os PDFs são lidos no navegador, divididos em trechos (um por pergunta numerada; sem numeração, 1000 caracteres) e indexados.
            Um PDF com o mesmo nome substitui o anterior.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1">
              <Label htmlFor="pdfs">Arquivos PDF</Label>
              <Input
                id="pdfs" type="file" accept="application/pdf" multiple disabled={!!progresso}
                onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="categoria">Categoria</Label>
              <Select value={categoria} onValueChange={(v) => setCategoria(v as Categoria)} disabled={!!progresso}>
                <SelectTrigger id="categoria"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={processar} disabled={arquivos.length === 0 || !!progresso}>
            {progresso ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Upload className="mr-2 h-4 w-4" aria-hidden />}
            Processar {arquivos.length > 0 ? `(${arquivos.length})` : ''}
          </Button>

          {progresso && (
            <div className="space-y-2" role="status" aria-live="polite">
              <p className="text-sm">
                <strong>{progresso.arquivo}</strong> — {progresso.etapa}
              </p>
              <Progress value={pct} />
              <p className="text-xs text-muted-foreground">
                Página {progresso.pagina} de {progresso.totalPaginas || '…'}
                {progresso.totalChunks > 0 && ` · ${progresso.enviados} de ${progresso.totalChunks} chunks enviados`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Documentos indexados</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {carregandoDocs ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Carregando" />
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Páginas</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="max-w-[260px] truncate" title={d.nome}>{d.nome}</TableCell>
                    <TableCell>{d.categoria}</TableCell>
                    <TableCell className="text-right">{d.total_paginas}</TableCell>
                    <TableCell className="text-right">{d.chunks?.[0]?.count ?? 0}</TableCell>
                    <TableCell>{new Date(d.created_at).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Excluir ${d.nome}`} disabled={!!progresso}>
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir documento?</AlertDialogTitle>
                            <AlertDialogDescription>
                              "{d.nome}" e todos os seus trechos serão removidos da base. Isso não pode ser desfeito.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => excluir(d)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [aal2, setAal2] = useState<boolean | null>(null)
  const [pronto, setPronto] = useState(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setPronto(true) })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setIsAdmin(null); setAal2(null); return }
    // Só para exibir a tela; a permissão real é verificada pelo RLS e pela Edge Function.
    supabase
      .from('user_roles').select('role').eq('user_id', session.user.id).eq('role', 'admin').maybeSingle()
      .then(({ data, error }) => setIsAdmin(!error && !!data))
    supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data }) => setAal2(data?.currentLevel === 'aal2'))
  }, [session])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar ao chat
          </Link>
          <h1 className="text-2xl font-bold text-primary">Base de conhecimento</h1>
        </div>
        {session && (
          <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>
            <LogOut className="mr-1 h-4 w-4" aria-hidden /> Sair
          </Button>
        )}
      </header>

      {!pronto ? (
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" />
      ) : !session ? (
        <Login />
      ) : isAdmin === null || aal2 === null ? (
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Verificando permissão" />
      ) : !isAdmin ? (
        <Card className="mx-auto mt-16 max-w-sm text-center">
          <CardHeader>
            <CardTitle>Acesso negado</CardTitle>
            <CardDescription>Sua conta ({session.user.email}) não tem permissão de administrador.</CardDescription>
          </CardHeader>
        </Card>
      ) : !aal2 ? (
        <SegundoFator onVerificado={() => setAal2(true)} />
      ) : (
        <BaseDeConhecimento />
      )}
    </div>
  )
}
