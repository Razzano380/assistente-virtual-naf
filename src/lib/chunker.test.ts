import { describe, expect, it } from 'vitest'
import { chunkDocumento, chunkPages, splitText } from './chunker'

const texto = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(' ').slice(0, 2500)

describe('splitText (1000 / 200)', () => {
  const chunks = splitText(texto)

  it('gera mais de um chunk para 2500 caracteres', () => {
    expect(texto.length).toBe(2500)
    expect(chunks.length).toBeGreaterThan(2)
  })

  it('nenhum chunk passa de 1000 caracteres', () => {
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000)
  })

  it('chunks consecutivos se sobrepõem', () => {
    for (let i = 1; i < chunks.length; i++) {
      const inicio = chunks[i].slice(0, 30)
      expect(chunks[i - 1]).toContain(inicio)
    }
  })

  it('não perde texto: o fim do documento está no último chunk', () => {
    expect(chunks[chunks.length - 1].endsWith(texto.trim().slice(-20))).toBe(true)
  })
})

describe('chunkPages', () => {
  it('mantém a página de origem de cada chunk', () => {
    const out = chunkPages([
      { pagina: 1, texto: 'curto' },
      { pagina: 2, texto },
    ])
    expect(out[0]).toEqual({ conteudo: 'curto', pagina: 1 })
    expect(out.slice(1).every((c) => c.pagina === 2)).toBe(true)
  })
})

describe('chunkDocumento (um bloco por pergunta)', () => {
  const perguntas = Array.from({ length: 12 }, (_, i) => `${String(i + 1).padStart(3, '0')} — Pergunta ${i + 1}\ncontinua aqui?\nResposta ${i + 1}.`)
  const paginas = [
    { pagina: 1, texto: 'Capa do documento\nSumário\n1.1 Pergunta do sumário?.........3' },
    { pagina: 2, texto: perguntas.slice(0, 6).join('\n') },
    { pagina: 3, texto: perguntas.slice(6).join('\n') + '\n' + `013 — Pergunta longa?\n${texto}` },
  ]
  const out = chunkDocumento(paginas)

  it('cada trecho começa com o título completo da pergunta e traz a página certa', () => {
    expect(out).toContainEqual({ conteudo: '001 — Pergunta 1 continua aqui?\nResposta 1.', pagina: 2 })
    expect(out).toContainEqual({ conteudo: '007 — Pergunta 7 continua aqui?\nResposta 7.', pagina: 3 })
  })

  it('resposta longa: todos os trechos repetem o título e cabem em 1000 caracteres', () => {
    const longa = out.filter((c) => c.conteudo.startsWith('013 —'))
    expect(longa.length).toBeGreaterThan(2)
    for (const c of longa) {
      expect(c.conteudo.startsWith('013 — Pergunta longa?\n')).toBe(true)
      expect(c.conteudo.length).toBeLessThanOrEqual(1000)
    }
  })

  it('mantém o preâmbulo e descarta linhas do sumário', () => {
    expect(out[0]).toEqual({ conteudo: 'Capa do documento\nSumário', pagina: 1 })
    expect(out.some((c) => c.conteudo.includes('.....'))).toBe(false)
  })

  it('numeração "344. " (gov_MEI): pergunta vira bloco, lista numerada dentro da resposta não', () => {
    const t = Array.from({ length: 12 }, (_, i) => `${i + 340}. Posso fazer ${i}?\nSim:\n1. primeiro passo;\n2. segundo passo.`).join('\n')
    const blocos = chunkDocumento([{ pagina: 5, texto: t }])
    expect(blocos).toHaveLength(12)
    expect(blocos[4]).toEqual({ conteudo: '344. Posso fazer 4?\nSim:\n1. primeiro passo;\n2. segundo passo.', pagina: 5 })
  })

  it('sem perguntas numeradas, corta por tamanho', () => {
    expect(chunkDocumento([{ pagina: 1, texto }])).toEqual(chunkPages([{ pagina: 1, texto }]))
  })
})
