import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import Index from '@/pages/Index'

// pdfjs só é baixado por quem abre o /admin.
const Admin = lazy(() => import('@/pages/Admin'))

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/admin" element={<Suspense fallback={null}><Admin /></Suspense>} />
        <Route path="*" element={<Index />} />
      </Routes>
      <Toaster theme="dark" richColors position="top-center" />
    </BrowserRouter>
  )
}
