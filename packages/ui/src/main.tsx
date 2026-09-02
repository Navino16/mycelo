import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
// Vendored: @rjsf/shadcn exports no CSS path (see src/rjsf-shadcn.css's own header).
import './rjsf-shadcn.css'

const root = document.getElementById('root')
if (root === null) throw new Error('#root is missing from index.html')
createRoot(root).render(<StrictMode><App /></StrictMode>)
