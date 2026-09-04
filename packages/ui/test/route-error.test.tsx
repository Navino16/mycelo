import { render, screen } from '@testing-library/react'
import { expect, it } from 'bun:test'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { I18nProvider } from '../src/i18n.tsx'
import { RouteError } from '../src/shell/RouteError.tsx'
import { routes } from '../src/routes.tsx'

function Boom(): React.JSX.Element {
  throw new Error('a screen threw')
}

// createMemoryRouter, not the app's shared createBrowserRouter singleton, so this test
// carries its own isolated history rather than the real app's.
it('renders a translated sentence when a screen throws, not the raw router page', () => {
  const router = createMemoryRouter(
    [{ path: '/', element: <Boom />, errorElement: <RouteError /> }],
    { initialEntries: ['/'] },
  )
  render(<I18nProvider><RouterProvider router={router} /></I18nProvider>)

  expect(screen.getByText('Something went wrong')).toBeDefined()
})

// Not just "some errorElement is set": the shipped route table must use this exact component.
it('the shipped route table wires RouteError as its error boundary', () => {
  const element = routes[0]?.errorElement as React.ReactElement | undefined
  expect(element?.type).toBe(RouteError)
})
