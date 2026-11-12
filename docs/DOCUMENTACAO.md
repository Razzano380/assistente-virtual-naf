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
                          ──> match_documents: 20 candidatos mais parecidos (pgvector)
                          ──> Groq gpt-oss-20b: escolhe os 6 trechos que respondem
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

### Avaliação da busca (10/11/2026)

Gabarito em `scripts/gabarito.json`: 74 perguntas escritas em linguagem do dia a dia (não copiadas dos PDFs), espalhadas pelos 4 documentos, cada uma com documento e página da resposta oficial, mais 6 perguntas fora da base. O script `npm run avaliar` usa o mesmo corte e o mesmo modelo do app e verifica se a página certa está entre os 6 trechos enviados à IA. Não avalia o texto final da IA.

| Documento | Acertos |
|---|---|
| P&R IRPF 2024 | 28/30 |
| Dirf 2025 | 12/13 |
| perguntaS_mei | 14/17 |
| P&R gov_MEI | 14/14 |
| **Total** | **68/74 (92%)**, posição média inversa (MRR) 0,667 |

**Escolha pela IA (11/11/2026, adotada):** a busca por vetor traz 20 candidatos (o trecho certo está entre eles em 74 de 74 perguntas) e o modelo `openai/gpt-oss-20b` lê o começo de cada um e escolhe os 6 que vão para a resposta. Teste de ponta a ponta no chat publicado (`npm run avaliar:chat`): **77/80 (96%)**, contra 68/74 (92%) da busca anterior. As 6 falhas antigas passaram; as 6 perguntas fora da base receberam "Não encontrei". Erraram: "Como declarar aluguel que eu recebo?" e "Recebi dinheiro do dono para sair do imóvel alugado…" (fontes em páginas vizinhas à esperada) e "Posso fechar o MEI com dívidas em atraso?" ("Não encontrei").

**Depois do divisor do gov_MEI e do filtro de assunto (12/11/2026): 78/80 (97,5%).** O divisor passou a reconhecer a numeração "344. " (gov_MEI de 159 para 382 trechos, uma pergunta por trecho) e o MEI com dívidas passou a ser respondido; o gabarito aceita a pergunta equivalente do outro PDF de MEI em 6 casos. Uma regra rígida no prompt ("só responda se um trecho tratar diretamente da pergunta") derrubou 2 respostas certas e foi retirada; ficou só a regra de que mensagens soltas ou fora do assunto ("sabao", "oi") recebem "Não encontrei". Ainda erram: "Como declarar aluguel que eu recebo?" (a pergunta certa fica fora dos 6 escolhidos) e "Recebi dinheiro do dono para sair do imóvel alugado…" (o modelo respondeu "Não encontrei"; numa execução anterior havia respondido).

Quando a resposta não está nos documentos, o chat mostra um link para consulta: Guia do MEI do Sebrae (perguntas sobre MEI) ou site da Receita Federal (as demais).

Tentativas de melhoria medidas no mesmo gabarito (nenhuma superou a busca atual, que foi mantida):

| Variante | Acertos | MRR |
|---|---|---|
| Atual: trecho inteiro, multilingual-e5-small | **68/74** | 0,667 |
| Nota combinada com o vetor só do título da pergunta (peso 0,3) | 65/74 | 0,708 |
| Busca híbrida: vetor + BM25 por palavras (fusão RRF, peso 0,3) | 67/74 | 0,692 |
| Modelo maior, multilingual-e5-base (768 dim.) | 62/74 | 0,599 |

Falhas: prazo de entrega do IR (a busca traz o prazo da Dirf), calendário da restituição, rendimentos acumulados na Dirf, obrigações do MEI, prazo da DASN-Simei e excesso de faturamento do MEI. Nas perguntas fora da base, a similaridade do 1º trecho (0,82 a 0,88) fica na mesma faixa das respostas certas: um corte por similaridade não separaria "tem" de "não tem"; quem decide é a IA, pelo prompt.

## 8. Funcionalidades em desenvolvimento

- Corrigir as 2 perguntas que ainda erram no teste de ponta a ponta (ver acima).

O aplicativo está publicado em https://razzano380.github.io/assistente-virtual-naf/app/ (build estático em `docs/app`, gerado por `npm run build:pages`).

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

- **Corrigir as 2 falhas restantes** (97,5% de ponta a ponta). Cada mudança é medida com `npm run avaliar` (busca, sem custo) e `npm run avaliar:chat` (chat publicado, gasta cota da Groq; ~45 min por causa do limite de uso).
- O chat baixa ~113 MB (modelo) na primeira visita; fica em cache no navegador.
- Registrar uma demonstração com resposta e fontes.
- Ideia em avaliação: uma segunda chamada à IA conferindo se a resposta está nos trechos (custa uma chamada a mais por pergunta).
- Feito em 12/11: histórico de conversa (as últimas 6 mensagens vão ao modelo; pergunta de até 7 palavras é buscada junto com a anterior), streaming (SSE; o texto final limpo e as fontes chegam no evento `fim`) e filtro por categoria (a função busca 80 trechos e filtra por categoria, sem mudar o SQL).
- Migrar da chave `service_role` legada para as chaves novas do Supabase antes de 2027.

## 11. Referências

- Receita Federal: Perguntas e Respostas IRPF 2024, Perguntas e Respostas MEI, Perguntas e Respostas Dirf 2025.
- Supabase: documentação de pgvector, Edge Functions e Row Level Security (https://supabase.com/docs).
- Groq: documentação da API (https://console.groq.com/docs).
- LangChain: `RecursiveCharacterTextSplitter`, base do divisor de texto.
- Modelo multilingual-e5-small (https://huggingface.co/intfloat/multilingual-e5-small; versão ONNX Xenova/multilingual-e5-small).
