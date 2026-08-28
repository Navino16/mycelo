import { createBrowserRouter } from 'react-router'
import { Layout } from './shell/Layout.tsx'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <div /> },
    ],
  },
])
