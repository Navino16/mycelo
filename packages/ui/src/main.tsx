import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
// Vendored (@rjsf/shadcn exports no CSS path) and a whole Tailwind build, so it must come first:
// imported after index.css, its utilities layer wins every tie against our md: variants.
import './rjsf-shadcn.css'
import './index.css'

const root = document.getElementById('root')
if (root === null) throw new Error('#root is missing from index.html')
createRoot(root).render(<StrictMode><App /></StrictMode>)
