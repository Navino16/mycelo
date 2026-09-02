import { afterEach, describe, expect, it } from 'bun:test'
import { bootAndLogin, closeBooted, configurable } from './support.js'
import type { LoggedIn } from './support.js'

let booted: LoggedIn | undefined
afterEach(async () => {
  if (booted === undefined) return
  await closeBooted(booted)
  booted = undefined
})

describe('the form schema names the secret keys', () => {
  // fixtures/vault declares { secrets: ['token'] }. Without this the form cannot mask a
  // credential the operator has not filled in yet: it is in neither the schema nor the
  // redacted settings, so it renders as an ordinary text input.
  it('answers the declared secrets beside the schema', async () => {
    booted = await bootAndLogin()
    const { app, cookie } = booted

    const body = (await app.inject({
      method: 'GET', url: '/api/plugins/vault/schema', headers: { cookie },
    })).json<{ available: boolean, secrets?: readonly string[] }>()

    expect(body.available).toBe(true)
    expect(body.secrets).toEqual(['token'])
  })

  // fixtures/gate is available: false (no toJsonSchema()), so it never reaches the
  // `secrets` branch; support.ts's `configurable` ('needs-config') has a real schema and
  // declares no secrets, which is the actual negative control.
  it('answers an empty list for a plugin declaring none, never an absent one', async () => {
    booted = await bootAndLogin({ spores: configurable })
    const { app, cookie } = booted

    const body = (await app.inject({
      method: 'GET', url: '/api/plugins/needs-config/schema', headers: { cookie },
    })).json<{ secrets?: readonly string[] }>()

    // [] and absent are different facts: absent would mean "this route does not say".
    expect(body.secrets).toEqual([])
  })
})
