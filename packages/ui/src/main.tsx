import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
// The generated settings form's only theme, and it ships no external font or asset URL.
import '@rjsf/shadcn/dist/default.css'

const root = document.getElementById('root')
if (root === null) throw new Error('#root is missing from index.html')
createRoot(root).render(<StrictMode><App /></StrictMode>)
