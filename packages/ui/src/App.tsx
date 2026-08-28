import { createBrowserRouter, RouterProvider } from 'react-router'
import { AuthGate } from './auth.tsx'
import { HealthProvider } from './health.tsx'
import { I18nProvider } from './i18n.tsx'
import { routes } from './routes.tsx'

const router = createBrowserRouter(routes)

export function App(): React.JSX.Element {
  return (
    <I18nProvider>
      <AuthGate>
        <HealthProvider><RouterProvider router={router} /></HealthProvider>
      </AuthGate>
    </I18nProvider>
  )
}
