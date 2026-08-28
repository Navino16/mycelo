import { RouterProvider } from 'react-router'
import { I18nProvider } from './i18n.tsx'
import { router } from './routes.tsx'

export function App(): React.JSX.Element {
  return <I18nProvider><RouterProvider router={router} /></I18nProvider>
}
