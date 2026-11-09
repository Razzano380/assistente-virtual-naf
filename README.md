# Assistente Virtual NAF

Chatbot RAG que responde dúvidas sobre IRPF, MEI e DIRF **apenas** com base em PDFs oficiais da Receita Federal.
É uma recriação do chatbot "Trabalho Garantido" (Streamlit + LangChain + Chroma + Groq) na stack Lovable.

- **Página de apresentação:** https://razzano380.github.io/assistente-virtual-naf/
- **Documentação completa:** [docs/DOCUMENTACAO.md](docs/DOCUMENTACAO.md)
- **Estágio (09/11/2026):** interface, banco e funções prontos e publicados; a base de conhecimento ainda está sendo carregada.

## Fluxo RAG

```
Pergunta → embedding (gte-small, 384 dim) → busca no pgvector (top 5, cosseno)
        → prompt + contexto → Groq GPT-OSS-120B (temperature 0) → resposta com fontes
```

Ingestão (página `/admin`): PDF → `pdfjs-dist` no navegador (texto por página) → splitter recursivo 1000/200
→ embeddings gte-small gerados no navegador (`@huggingface/transformers`, ~35 MB baixados na 1ª vez;
o limite de ~2 s de CPU do plano gratuito impede gerá-los na Edge Function) → `ingest` grava em `chunks`.

| Arquivo | Papel |
|---|---|
| `src/lib/pdf.ts` | Extrai o texto de cada página (mantém as quebras de linha) |
| `src/lib/chunker.ts` | Port do `RecursiveCharacterTextSplitter` (1000 / 200) |
| `src/pages/Index.tsx` + `src/components/chat/*` | Chat público |
| `src/pages/Admin.tsx` | Login, upload de PDFs, lista e exclusão de documentos |
| `supabase/migrations/*.sql` | pgvector, tabelas, `match_documents`, papéis e RLS |
| `supabase/functions/ingest` | Cria o documento e grava os chunks com embedding (somente admin) |
| `supabase/functions/chat` | Busca top 5 + chamada à Groq (pública) |

## Configuração

1. Crie um projeto Supabase (ou use o Lovable Cloud) e aplique `supabase/migrations/20261108000000_naf_rag.sql`.
2. Faça o deploy das funções `chat` e `ingest` (as duas com `verify_jwt = false`; a `ingest` valida o JWT e o papel admin no próprio código).
3. Cadastre o Secret **`GROQ_API_KEY`** (crie a chave em https://console.groq.com/keys). Ela nunca vai para o front-end.
4. Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
5. `npm install` e depois `npm run dev`.

## Primeiro administrador

Um trigger em `auth.users` dá o papel `admin` ao **primeiro usuário cadastrado** (enquanto `user_roles` estiver vazia).
Por isso, cadastre-se em `/admin` antes de divulgar o link. Para adicionar outro admin depois, rode no SQL:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'pessoa@exemplo.com';
```

## Base de conhecimento

Em `/admin`, envie os PDFs com a categoria certa: P&R IRPF 2024 → IRPF, P&R MEI e perguntas_mei → MEI, Dirf 2025 → DIRF.
Um PDF com o mesmo nome substitui o anterior. PDFs escaneados (só imagem) não têm texto e são recusados.

## Testes

`npm test` roda o teste do splitter (nenhum chunk passa de 1000 caracteres e chunks consecutivos se sobrepõem).
