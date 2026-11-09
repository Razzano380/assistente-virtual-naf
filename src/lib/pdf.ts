import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PaginaPdf { pagina: number; texto: string }

/** Extrai o texto de cada página, preservando quebras de linha (hasEOL). */
export async function extrairPaginas(
  file: File,
  onProgress?: (pagina: number, total: number) => void,
): Promise<PaginaPdf[]> {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const paginas: PaginaPdf[] = []
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      let texto = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        texto += item.str + (item.hasEOL ? '\n' : '')
      }
      paginas.push({ pagina: n, texto })
      page.cleanup()
      onProgress?.(n, pdf.numPages)
    }
  } finally {
    await pdf.destroy()
  }
  return paginas
}
