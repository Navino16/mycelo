import type { RouteObject } from 'react-router'
import { BrowseSource } from './screens/BrowseSource.tsx'
import { Overview } from './screens/Overview.tsx'
import { PluginDetail } from './screens/PluginDetail.tsx'
import { PluginSettings } from './screens/PluginSettings.tsx'
import { Plugins } from './screens/Plugins.tsx'
import { SporeDetail } from './screens/SporeDetail.tsx'
import { Sources } from './screens/Sources.tsx'
import { Layout } from './shell/Layout.tsx'
import { RouteError } from './shell/RouteError.tsx'

// Each later task adds one entry to `children` (e.g. { path: 'sources', element: <Sources /> }).
// A public route (login, setup) is a sibling of this object, not a child: it must not render
// inside <Layout>, since a screen with no principal has no nav to show.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'plugins', element: <Plugins /> },
      { path: 'plugins/:name', element: <PluginDetail /> },
      { path: 'plugins/:name/settings', element: <PluginSettings /> },
      { path: 'sources', element: <Sources /> },
      { path: 'sources/:id', element: <BrowseSource /> },
      { path: 'sources/:id/spores/:name', element: <SporeDetail /> },
    ],
  },
]
