import { render, screen } from '@testing-library/react'
import { expect, it } from 'bun:test'
import { App } from '../src/App.tsx'

it('renders the shell, which proves happy-dom is preloaded from bunfig.toml', () => {
  render(<App />)
  expect(screen.getByText('Plugins')).toBeDefined()
})
