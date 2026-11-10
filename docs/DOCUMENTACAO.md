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
| Embeddings | multilingual-e5-small, 384 dimensões, gerados no navegador com `@huggingface/transformers` (trechos e pergunta) |
| Servidor | Supabase Edge Functions (Deno) |
| Banco | Supabase Postgres + pgvector, índice HNSW (cosseno) |
| LLM | Groq, `openai/gpt-oss-120b`, temperatura 0 |
| Acesso | Supabase Auth, tabela `user_roles`, Row Level Security |
| Testes | Vitest |

## 5. Arquitetura

```
PERGUNTA
navegador: embedding da pergunta (multilingual-e5-small, prefixo "query: ")
navegador ──> função chat (pergunta + vetor)
                          ──> match_documents: 6 trechos mais parecidos (pgvector)
                          ──> Groq: resposta usando só os trechos
          <── resposta + fontes (documento, categoria, página)

DOCUMENTO (somente admin)
PDF ──> texto por página (pdfjs) ──> trechos 1000/200 ──> embeddings no navegador
    ──> função ingest (confere login e papel admin, valida) ──> tabela chunks
```

Parâmetros: **um bloco por pergunta** do documento (marcadores "001 — " no P&R IRPF e "1.8. " na Dirf e no P&R MEI), cada trecho com até 1000 caracteres e sempre começando pelo título da pergunta; documentos sem perguntas numeradas (P&R gov_MEI) usam trechos de 1000 caracteres com 200 de sobreposição. Linhas do sumário são descartadas. 6 trechos por pergunta, temperatura 0; 8 trechos estouraram o limite de tokens por minuto da Groq no plano gratuito (erro 429).

### Banco de dados

- `documents`: nome (único), categoria (IRPF, MEI, DIRF, Outros), total de páginas.
- `chunks`: conteúdo, página, embedding `vector(384)`, ligado ao documento (exclusão em cascata).
- `user_roles` e função `has_role`: controle de administradores. O primeiro usuário cadastrado vira admin.
- `chat_uso` e função `chat_permitido`: contagem de uso do chat (hash do IP), só para o servidor.
- `match_documents`: busca por similaridade, executável apenas pelo servidor.

### Segurança

- A chave da Groq fica nos Secrets do Supabase. O navegador só conhece a chave pública.
- RLS: apenas administradores **com verificação em duas etapas (TOTP, sessão `aal2`)** leem e alteram `documents` e `chunks`.
- A função `ingest` valida o login, o papel de admin e o segundo fator em cada chamada, e valida o formato de cada trecho e vetor.
- Cadastro público desligado: administradores são criados pelo painel do Supabase.
- Limite de uso da função `chat`: 20 perguntas por IP a cada 10 minutos e 500 por dia no total (protege a cota da Groq). O IP é guardado só como hash SHA-256 (tabela `chat_uso`, acessível apenas pelo servidor).
- Todo o tráfego usa HTTPS (TLS 1.2/1.3); senhas com bcrypt; dados em repouso com AES-256 (Supabase).
- O prompt do sistema instrui o modelo a ignorar instruções vindas da pergunta ou dos documentos.

## 6. Etapas de desenvolvimento

1. Análise do chatbot de referência e levantamento dos requisitos.
2. Construção da interface (chat e administração) e do divisor de texto, com testes.
3. Modelagem do banco, permissões e funções do servidor.
4. Publicação no Supabase.
5. Correção do limite de processamento na ingestão (ver seção 9).
6. Repositório público e página de apresentação.
7. Carga dos 4 PDFs (1.669 trechos) e primeiros testes reais: correção das citações de página e diagnóstico da qualidade da busca.
8. Troca para o modelo multilingual-e5-small, reprocessamento da base e novo teste (4 de 5 perguntas respondidas).
9. Trechos cortados por pergunta e busca com 6 trechos. Base reprocessada (1.867 trechos) e novo teste no chat: 5 de 5 perguntas respondidas.

## 7. Funcionalidades implementadas

- Chat com resposta em Markdown e lista de fontes.
- Resposta padrão quando a informação não está na base.
- Login, cadastro e papel de administrador.
- Upload de PDF com progresso, listagem com contagem de trechos e exclusão.
- Substituição automática de documento com o mesmo nome.
- Recusa de PDFs sem texto (escaneados).
- Mensagens de erro específicas (configuração ausente, limite excedido, sem conexão).

## 8. Funcionalidades em desenvolvimento

- Qualidade da busca: perguntas como "Quem está obrigado a declarar o IR?" ainda não encontram a resposta (ver seção 9).
- Publicação do aplicativo em endereço público.

## 9. Problemas encontrados e soluções

| Problema | Causa | Solução |
|---|---|---|
| Erro 546 no envio de PDFs | O plano gratuito do Supabase limita cada função a cerca de 2 s de CPU; gerar embeddings em lote passa disso | Embeddings dos trechos gerados no navegador com o mesmo modelo; a função só valida e grava |
| "Failed to send a request to the Edge Function" | Variáveis de ambiente vazias e funções não publicadas | Configuração do `.env`, publicação das funções e mensagens de erro mais claras |
| Documentos com 0 trechos | Uploads interrompidos pelo erro 546 | Reenvio; o mesmo nome substitui o registro anterior |
| Respostas citavam páginas inexistentes (ex.: "página 377" num PDF de 301 páginas) | O modelo confundia o número da pergunta ("377 —") com o da página | O modelo não escreve mais fontes; as páginas exibidas vêm do banco |
| "Não encontrei" acompanhado de lista de fontes | A lista mostrava os trechos consultados mesmo sem resposta | Sem resposta, a lista de fontes fica vazia |
| Algumas perguntas simples não são respondidas (ex.: "Quem está obrigado a declarar o IR?", "O que é MEI?") | O gte-small foi treinado em inglês e separa mal trechos em português; além disso, o documento usa outras palavras ("apresentar a Declaração de Ajuste Anual") | Testado sem sucesso: busca por palavras, busca híbrida e reescrita da pergunta. **Adotado:** multilingual-e5-small no navegador. Com a base reprocessada, o chat responde "O que é MEI?", "Quem pode ser MEI?", despesas médicas e prazo da DIRF 2025. A de obrigatoriedade do IR seguia falhando: o modelo acha a pergunta 031 ("Meu Imposto de Renda") mais parecida. **Resolvido:** trechos por pergunta e busca com 6 trechos; a pergunta é respondida no chat (ver seção 10) |

## 10. Próximos passos

- **Ampliar o teste da busca.** Com os trechos por pergunta e 6 trechos por busca, as 5 perguntas do teste são respondidas no chat (09/11/2026). A de obrigatoriedade entra com margem pequena (a pergunta 001 é o 6º trecho). Próximo passo: uma lista maior de perguntas com resposta conhecida; se aparecerem falhas parecidas, um modelo de embeddings maior ou um reordenador (reranker).
- O chat baixa ~113 MB (modelo) na primeira visita; fica em cache no navegador.
- Concluir a carga da base e registrar uma demonstração com resposta e fontes.
- Medir a qualidade com uma lista de perguntas de resposta conhecida.
- Histórico de conversa, resposta em streaming e filtro por categoria.
- Migrar da chave `service_role` legada para as chaves novas do Supabase antes de 2027.

## 11. Referências

- Receita Federal: Perguntas e Respostas IRPF 2024, Perguntas e Respostas MEI, Perguntas e Respostas Dirf 2025.
- Supabase: documentação de pgvector, Edge Functions e Row Level Security (https://supabase.com/docs).
- Groq: documentação da API (https://console.groq.com/docs).
- LangChain: `RecursiveCharacterTextSplitter`, base do divisor de texto.
- Modelo multilingual-e5-small (https://huggingface.co/intfloat/multilingual-e5-small; versão ONNX Xenova/multilingual-e5-small).
