import { Outlet } from 'react-router'
import { ChromeProvider } from '../chrome.tsx'
import { Nav } from './Nav.tsx'

function Shell(): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-w-0 flex-1 p-4 pb-20 md:pb-4"><Outlet /></main>
      </div>
    </div>
  )
}

export function Layout(): React.JSX.Element {
  return <ChromeProvider><Shell /></ChromeProvider>
}
