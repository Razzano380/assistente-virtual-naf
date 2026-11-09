import { describe, expect, it } from 'vitest'
import { chunkPages, splitText } from './chunker'

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
