import { afterEach, describe, expect, it } from 'bun:test'
import { bootAndLogin, closeBooted } from './support.js'
import type { LoggedIn } from './support.js'
import { setPrincipalLocale } from '../../src/i18n/locale.js'
import { principal } from '../../src/persistence/schema.js'

let booted: LoggedIn | undefined
afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  booted = undefined
})

describe('the locale override', () => {
  it('wins when there is no saved locale to compete with', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted
    // The session principal has no /lang choice here, so the control below is what
    // distinguishes "the header won" from "there was nothing to beat".
    const overridden = await app.inject({
      method: 'GET', url: '/api/commands',
      headers: { cookie, 'x-mycelo-locale': 'fr', 'accept-language': 'en' },
    })
    const fallback = await app.inject({
      method: 'GET', url: '/api/commands', headers: { cookie, 'accept-language': 'en' },
    })

    expect(overridden.statusCode).toBe(200)
    expect(fallback.statusCode).toBe(200)
    expect(overridden.body).not.toBe(fallback.body)
  })

  it('wins over a principal that HAS saved a locale, not merely one that never chose', async () => {
    booted = await bootAndLogin()
    const { app, cookie, served } = booted
    const owner = served.state.db.select({ id: principal.id }).from(principal).get()
    if (owner === undefined) throw new Error('no principal after setup')
    setPrincipalLocale(served.state.db, owner.id, 'en')

    const overridden = await app.inject({
      method: 'GET', url: '/api/commands', headers: { cookie, 'x-mycelo-locale': 'fr' },
    })
    const withSavedLocale = await app.inject({
      method: 'GET', url: '/api/commands', headers: { cookie },
    })

    expect(overridden.statusCode).toBe(200)
    expect(withSavedLocale.statusCode).toBe(200)
    expect(overridden.body).not.toBe(withSavedLocale.body)
  })

  it('ignores a locale no catalogue provides, rather than answering the fallback silently', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted

    const bogus = await app.inject({
      method: 'GET', url: '/api/commands', headers: { cookie, 'x-mycelo-locale': 'zz' },
    })
    const plain = await app.inject({ method: 'GET', url: '/api/commands', headers: { cookie } })

    expect(bogus.body).toBe(plain.body)
  })

  // spec §11: /healthz is what a deploy script polls, and it must not depend on what that
  // script happens to send.
  // Presently unfalsifiable: the handler never reads request.locale, and OPEN_PATHS returns
  // before principalId is set, so no override can reach it either way. A later phase that
  // localizes /healthz gets no warning from this test.
  it('does not reach /healthz, which keeps defaultLocale outright', async () => {
    booted = await bootAndLogin({ config: 'defaultLocale: en\n' })
    const { app } = booted

    const answer = await app.inject({
      method: 'GET', url: '/healthz', headers: { 'x-mycelo-locale': 'fr' },
    })

    expect(answer.statusCode).toBe(200)
  })
})
