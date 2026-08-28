import type { RouteObject } from 'react-router'
import { Layout } from './shell/Layout.tsx'
import { RouteError } from './shell/RouteError.tsx'

// Each later task adds one entry to `children` (e.g. { path: 'plugins', element: <Plugins /> }).
// A public route (login, setup) is a sibling of this object, not a child: it must not render
// inside <Layout>, since a screen with no principal has no nav to show.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      // Placeholder — task 7 replaces this with the overview screen.
      { index: true, element: <div /> },
    ],
  },
]
