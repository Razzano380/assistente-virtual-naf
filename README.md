# Assistente Virtual NAF

Chatbot RAG que responde dúvidas sobre IRPF, MEI e DIRF **apenas** com base em PDFs oficiais da Receita Federal.
É uma recriação do chatbot "Trabalho Garantido" (Streamlit + LangChain + Chroma + Groq) na stack Lovable.

- **Página de apresentação:** https://razzano380.github.io/assistente-virtual-naf/
- **Documentação completa:** [docs/DOCUMENTACAO.md](docs/DOCUMENTACAO.md)
- **App publicado:** https://razzano380.github.io/assistente-virtual-naf/app/ (`/app/admin/` para administradores)
- **Estágio (12/11/2026):** base carregada (4 PDFs, cerca de 2.090 trechos); no teste de ponta a ponta o chat acerta 78 de 80 perguntas do gabarito (97,5%).

## Fluxo RAG

```
Pergunta → embedding no navegador (multilingual-e5-small, 384 dim) → busca no pgvector (20 candidatos, cosseno)
        → Groq GPT-OSS-20B escolhe os 6 trechos que respondem
        → prompt + contexto → Groq GPT-OSS-120B (temperature 0) → resposta com fontes
```

Ingestão (página `/admin`): PDF → `pdfjs-dist` no navegador (texto por página) → um trecho por pergunta numerada (sem numeração: 1000/200)
→ embeddings multilingual-e5-small gerados no navegador (`@huggingface/transformers`, ~113 MB baixados na 1ª vez;
o limite de ~2 s de CPU do plano gratuito impede gerá-los na Edge Function) → `ingest` grava em `chunks`.

| Arquivo | Papel |
|---|---|
| `src/lib/pdf.ts` | Extrai o texto de cada página (mantém as quebras de linha) |
| `src/lib/chunker.ts` | Um bloco por pergunta numerada (`chunkDocumento`); sem numeração, port do `RecursiveCharacterTextSplitter` (1000 / 200) |
| `src/pages/Index.tsx` + `src/components/chat/*` | Chat público |
| `src/pages/Admin.tsx` | Login, upload de PDFs, lista e exclusão de documentos |
| `supabase/migrations/*.sql` | pgvector, tabelas, `match_documents`, papéis e RLS |
| `supabase/functions/ingest` | Cria o documento e grava os chunks com embedding (somente admin) |
| `supabase/functions/chat` | Busca top 6 + chamada à Groq (pública) |

## Configuração

1. Crie um projeto Supabase (ou use o Lovable Cloud) e aplique as migrations de `supabase/migrations/` em ordem (`20261108000000_naf_rag.sql`, depois `20261110000000_seguranca.sql`).
2. Faça o deploy das funções `chat` e `ingest` (as duas com `verify_jwt = false`; a `ingest` valida o JWT e o papel admin no próprio código).
3. Cadastre o Secret **`GROQ_API_KEY`** (crie a chave em https://console.groq.com/keys). Ela nunca vai para o front-end.
4. Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
5. `npm install` e depois `npm run dev`.
6. Para publicar no GitHub Pages: `npm run build:pages` (gera `docs/app`) e envie ao GitHub.

## Primeiro administrador

Um trigger em `auth.users` dá o papel `admin` ao **primeiro usuário cadastrado** (enquanto `user_roles` estiver vazia).
O app não tem tela de cadastro: crie o usuário em Supabase → Authentication → Users → **Add user** e depois
desligue "Allow new users to sign up" (Authentication → Sign In / Providers).

No primeiro acesso a `/admin`, o admin cadastra um **app autenticador** (QR code). Daí em diante o login pede o código
de 6 dígitos: o banco (RLS) e a função `ingest` só aceitam alterações de sessões com segundo fator (`aal2`).
Perdeu o celular? Apague o fator em Authentication → Users → (usuário) e cadastre de novo.

Para adicionar outro admin depois, crie o usuário pelo painel e rode no SQL:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'pessoa@exemplo.com';
```

## Base de conhecimento

Em `/admin`, envie os PDFs com a categoria certa: P&R IRPF 2024 → IRPF, P&R MEI e perguntas_mei → MEI, Dirf 2025 → DIRF.
Um PDF com o mesmo nome substitui o anterior. PDFs escaneados (só imagem) não têm texto e são recusados.

## Testes

`npm test` roda o teste do divisor de texto (tamanho dos trechos, sobreposição, corte por pergunta).

`npm run avaliar -- "<pasta com os 4 PDFs>"` mede a **busca** com o gabarito de [scripts/gabarito.json](scripts/gabarito.json)
(74 perguntas em linguagem do dia a dia, com documento e página esperados, mais 6 fora da base): diz se a página
certa aparece entre os 6 trechos que vão para a IA. Não usa a Groq. A 1ª execução gera os vetores (~5 min) e guarda
em `scripts/.cache`; as seguintes levam segundos. Para testar uma pergunta nova, acrescente-a no gabarito.

`npm run avaliar:chat` manda as mesmas perguntas ao **chat publicado** e confere as fontes da resposta (gasta cota
da Groq; espera 32 s entre perguntas por causa do limite de uso; retoma de onde parou).
