import { describe, expect, it } from 'bun:test'
import { configIssueRefs, configIssueRefsFor, issueRef } from '../../src/i18n/config-refs.js'
import { SHARED_DOMAIN } from '../../src/i18n/core-catalogs.js'

// The functions moved out of lifecycle.ts this phase, and their coverage did not follow: every
// case here is reachable from a plugin's own `safeParse`, and none of it was pinned anywhere.
describe('issueRef', () => {
  it("names the spore's own domain for a bare-string messageKey", () => {
    expect(issueRef({ messageKey: 'config.tokenMissing', message: 'token is required' }, 'plex'))
      .toEqual({ domain: 'plex', key: 'config.tokenMissing' })
  })

  it('carries the params beside the key', () => {
    expect(issueRef({ messageKey: 'config.tooSmall', params: { minimum: 1 } }, 'plex'))
      .toEqual({ domain: 'plex', key: 'config.tooSmall', params: { minimum: 1 } })
  })

  // An empty key is a plugin's accidental case, not a hostile one: without the length guard the
  // refusal reaches the operator as an empty sentence instead of the English the plugin authored.
  it('degrades an empty messageKey to the English message rather than to an empty key', () => {
    expect(issueRef({ messageKey: '', message: 'token is required' }, 'plex'))
      .toEqual({ domain: SHARED_DOMAIN, key: 'token is required' })
  })

  it('passes a common ref through, merging the issue params over its own', () => {
    expect(issueRef({
      messageKey: { domain: SHARED_DOMAIN, key: 'refusal.config.tooSmall', params: { origin: 'number' } },
      params: { minimum: 1 },
    }, 'plex')).toEqual({
      domain: SHARED_DOMAIN, key: 'refusal.config.tooSmall', params: { origin: 'number', minimum: 1 },
    })
  })

  // design §5.3: only `common` is open to every spore, so a ref naming another domain is not
  // this plugin's to render. Without the domain conjunct the operator is shown the bare dotted key.
  it('degrades a well-formed ref naming a foreign domain to the English message', () => {
    expect(issueRef({ messageKey: { domain: 'radarr', key: 'config.bad' }, message: 'url is invalid' }, 'plex'))
      .toEqual({ domain: SHARED_DOMAIN, key: 'url is invalid' })
  })

  it('falls back to a fixed literal when the message is not a string', () => {
    expect(issueRef({ path: ['url'], message: 7 }, 'plex'))
      .toEqual({ domain: SHARED_DOMAIN, key: 'unspecified issue' })
  })
})

describe('configIssueRefs', () => {
  // Every fixture in the suite has a flat config, so `path` is always one segment and the join
  // never joins: two failing fields under one nested object would be indistinguishable.
  it('names a nested field by its whole path, not by its first segment', () => {
    expect(configIssueRefs({ issues: [{ path: ['auth', 'token'], message: 'required' }] }, 'plex'))
      .toEqual([{
        domain: SHARED_DOMAIN,
        key: 'refusal.config.issueAt',
        params: { field: 'auth.token', cause: { domain: SHARED_DOMAIN, key: 'required' } },
      }])
  })

  // ConfigIssue.path is readonly PropertyKey[], so a symbol is inside the contract and
  // Array.prototype.join throws on one. thrown.test.ts still pins this for describeConfigError,
  // the function germination stopped calling — the coverage did not follow the code.
  it('renders a symbol path segment instead of throwing', () => {
    const s = Symbol('s')
    expect(configIssueRefs({ issues: [{ path: [s, 'token'], message: 'required' }] }, 'plex')[0]
      ?.params?.['field']).toBe('Symbol(s).token')
  })

  it('answers nothing for an error carrying no issues array', () => {
    expect(configIssueRefs({ issues: 'nope' }, 'plex')).toEqual([])
    expect(configIssueRefs(null, 'plex')).toEqual([])
  })
})

describe('configIssueRefsFor', () => {
  // A top-level `.refine()` carries an empty path: it refuses the object, so it belongs to the
  // one key the caller named. Dropped, PUT /api/plugins/:name/settings answers 200 and stores a
  // value the schema rejects.
  it("keeps a whole-object issue among the named key's own", () => {
    expect(configIssueRefsFor({
      issues: [{ path: [], message: 'socket or tcp, not both' }, { path: ['other'], message: 'required' }],
    }, 'plex', 'url')).toEqual([{ domain: SHARED_DOMAIN, key: 'socket or tcp, not both' }])
  })

  it("drops the issues another key owns", () => {
    expect(configIssueRefsFor({ issues: [{ path: ['other'], message: 'required' }] }, 'plex', 'url'))
      .toEqual([])
  })
})
