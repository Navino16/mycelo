import { MYCELIUM_SCOPES } from '../src/mycelium.js'
import type {
  HealthRead,
  MessagesSend,
  MyceliumScope,
  PluginsConfigure,
  PluginsRead,
  PluginsToggle,
  PrincipalsManage,
  PrincipalsRead,
  RoleInfo,
  RolesAssign,
  RolesManage,
  RolesRead,
} from '../src/mycelium.js'
import type { Principal } from '../src/context.js'

// Checked by `tsc -p tsconfig.spec.json`, never by bun test: these are claims about the
// published types, and `import type` is erased, so a runtime assertion cannot make them.
type Equal<A, B> = (<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false
type Expect<T extends true> = T

export type ScopeNamesAreExact = Expect<Equal<MyceliumScope,
  | 'principals.read' | 'principals.manage'
  | 'roles.read' | 'roles.assign' | 'roles.manage'
  | 'plugins.read' | 'plugins.toggle' | 'plugins.configure'
  | 'health.read' | 'messages.send'
>>

export type ScopesAreReadonly = Expect<Equal<typeof MYCELIUM_SCOPES, readonly [
  'principals.read', 'principals.manage',
  'roles.read', 'roles.assign', 'roles.manage',
  'plugins.read', 'plugins.toggle', 'plugins.configure',
  'health.read', 'messages.send',
]>>

// One entry per scope, `never` for a scope no phase mounts yet. A scope added to
// MYCELIUM_SCOPES without a decision here fails to compile — which is the point.
interface ScopeApi {
  'principals.read': PrincipalsRead
  'principals.manage': PrincipalsManage
  'roles.read': RolesRead
  'roles.assign': RolesAssign
  'roles.manage': RolesManage
  'plugins.read': PluginsRead
  'plugins.toggle': PluginsToggle
  'plugins.configure': PluginsConfigure
  'health.read': HealthRead
  'messages.send': MessagesSend
}

export type EveryScopeIsClassified = Expect<Equal<keyof ScopeApi, MyceliumScope>>

type Mounted = { [K in MyceliumScope]: ScopeApi[K] extends never ? never : K }[MyceliumScope]

export type EveryScopeMountsAnInterface = Expect<Equal<Mounted, MyceliumScope>>

// A plugin author's own implementation must satisfy each interface structurally. Deleting
// an interface, or widening a signature, stops this file compiling.
const alice: Principal = { id: 'p1', displayName: 'alice', identities: [], roles: ['owner'] }
const owner: RoleInfo = { name: 'owner', patterns: ['*'], builtin: true }

export const principalsRead: PrincipalsRead = {
  listPrincipals: () => Promise.resolve([alice]),
  getPrincipal: (id) => Promise.resolve(id === alice.id ? alice : null),
  findByIdentity: (channel, externalId) =>
    Promise.resolve(channel === 'console' && externalId === 'alice' ? alice : null),
}

export const principalsManage: PrincipalsManage = {
  markReviewed: () => Promise.resolve(),
  setDisplayName: () => Promise.resolve(),
}

export const rolesRead: RolesRead = {
  listRoles: () => Promise.resolve([owner]),
  rolesOf: () => Promise.resolve(['owner']),
}

export const rolesAssign: RolesAssign = {
  assignRole: () => Promise.resolve(),
  revokeRole: () => Promise.resolve(),
}

export const rolesManage: RolesManage = {
  createRole: () => Promise.resolve(),
  setRoleCommands: () => Promise.resolve(),
  deleteRole: () => Promise.resolve(),
}

export const pluginsToggle: PluginsToggle = {
  enable: () => Promise.resolve(),
  disable: () => Promise.resolve(),
}

export const pluginsConfigure: PluginsConfigure = {
  settings: () => Promise.resolve({ url: 'http://x', apiKey: '••••' }),
  setSetting: () => Promise.resolve(),
  formSchema: () => Promise.resolve({ available: true, schema: { type: 'object' } }),
}
