import { createBrowserRouter, RouterProvider } from 'react-router'
import { I18nProvider } from './i18n.tsx'
import { routes } from './routes.tsx'

const router = createBrowserRouter(routes)

export function App(): React.JSX.Element {
  return <I18nProvider><RouterProvider router={router} /></I18nProvider>
}
