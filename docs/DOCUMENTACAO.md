# Documentação do projeto — Assistente Virtual NAF

Atualizada em 09/11/2026.

## 1. Objetivo

Responder dúvidas sobre IRPF, MEI e DIRF com base **somente** nos documentos oficiais da Receita Federal, indicando o documento e a página de origem de cada resposta.

## 2. Problema

As respostas oficiais estão em PDFs longos (o "Perguntas e Respostas" do IRPF 2024 tem 301 páginas). Encontrar um trecho específico é demorado, e chatbots genéricos podem inventar informação fiscal.

## 3. Justificativa

A técnica RAG (Retrieval-Augmented Generation) prende a resposta ao conteúdo recuperado dos documentos. Quando nada relevante é encontrado, o sistema responde "Não encontrei essa informação nos documentos do NAF." em vez de arriscar.

O projeto recria, em tecnologia web, um chatbot de referência feito em Python (Streamlit, LangChain, Chroma, Groq), mantendo os mesmos parâmetros.

## 4. Tecnologias

| Camada | Tecnologia |
|---|---|
| Interface | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix), react-markdown |
| PDF | pdfjs-dist (extração de texto no navegador) |
| Embeddings | gte-small, 384 dimensões (`@huggingface/transformers` no navegador; `Supabase.ai` na função `chat`) |
| Servidor | Supabase Edge Functions (Deno) |
| Banco | Supabase Postgres + pgvector, índice HNSW (cosseno) |
| LLM | Groq, `openai/gpt-oss-120b`, temperatura 0 |
| Acesso | Supabase Auth, tabela `user_roles`, Row Level Security |
| Testes | Vitest |

## 5. Arquitetura

```
PERGUNTA
navegador ──> função chat ──> embedding da pergunta (gte-small)
                          ──> match_documents: 5 trechos mais parecidos (pgvector)
                          ──> Groq: resposta usando só os trechos
          <── resposta + fontes (documento, categoria, página)

DOCUMENTO (somente admin)
PDF ──> texto por página (pdfjs) ──> trechos 1000/200 ──> embeddings no navegador
    ──> função ingest (confere login e papel admin, valida) ──> tabela chunks
```

Parâmetros: trechos de 1000 caracteres com 200 de sobreposição, 5 trechos por pergunta, temperatura 0.

### Banco de dados

- `documents`: nome (único), categoria (IRPF, MEI, DIRF, Outros), total de páginas.
- `chunks`: conteúdo, página, embedding `vector(384)`, ligado ao documento (exclusão em cascata).
- `user_roles` e função `has_role`: controle de administradores. O primeiro usuário cadastrado vira admin.
- `match_documents`: busca por similaridade, executável apenas pelo servidor.

### Segurança

- A chave da Groq fica nos Secrets do Supabase. O navegador só conhece a chave pública.
- RLS: apenas administradores leem e alteram `documents` e `chunks`.
- A função `ingest` valida o login e o papel de admin em cada chamada, e valida o formato de cada trecho e vetor.
- O prompt do sistema instrui o modelo a ignorar instruções vindas da pergunta ou dos documentos.

## 6. Etapas de desenvolvimento

1. Análise do chatbot de referência e levantamento dos requisitos.
2. Construção da interface (chat e administração) e do divisor de texto, com testes.
3. Modelagem do banco, permissões e funções do servidor.
4. Publicação no Supabase.
5. Correção do limite de processamento na ingestão (ver seção 9).
6. Repositório público e página de apresentação.

## 7. Funcionalidades implementadas

- Chat com resposta em Markdown e lista de fontes.
- Resposta padrão quando a informação não está na base.
- Login, cadastro e papel de administrador.
- Upload de PDF com progresso, listagem com contagem de trechos e exclusão.
- Substituição automática de documento com o mesmo nome.
- Recusa de PDFs sem texto (escaneados).
- Mensagens de erro específicas (configuração ausente, limite excedido, sem conexão).

## 8. Funcionalidades em desenvolvimento

- Carga dos quatro PDFs na base (IRPF 2024, dois de MEI, DIRF 2025).
- Teste ponta a ponta com conferência da página citada.
- Publicação do aplicativo em endereço público.

## 9. Problemas encontrados e soluções

| Problema | Causa | Solução |
|---|---|---|
| Erro 546 no envio de PDFs | O plano gratuito do Supabase limita cada função a cerca de 2 s de CPU; gerar embeddings em lote passa disso | Embeddings dos trechos gerados no navegador com o mesmo modelo; a função só valida e grava |
| "Failed to send a request to the Edge Function" | Variáveis de ambiente vazias e funções não publicadas | Configuração do `.env`, publicação das funções e mensagens de erro mais claras |
| Documentos com 0 trechos | Uploads interrompidos pelo erro 546 | Reenvio; o mesmo nome substitui o registro anterior |

## 10. Próximos passos

- Concluir a carga da base e registrar uma demonstração com resposta e fontes.
- Medir a qualidade com uma lista de perguntas de resposta conhecida.
- Histórico de conversa, resposta em streaming e filtro por categoria.
- Migrar da chave `service_role` legada para as chaves novas do Supabase antes de 2027.

## 11. Referências

- Receita Federal: Perguntas e Respostas IRPF 2024, Perguntas e Respostas MEI, Perguntas e Respostas Dirf 2025.
- Supabase: documentação de pgvector, Edge Functions e Row Level Security (https://supabase.com/docs).
- Groq: documentação da API (https://console.groq.com/docs).
- LangChain: `RecursiveCharacterTextSplitter`, base do divisor de texto.
- Modelo gte-small (https://huggingface.co/Supabase/gte-small).
