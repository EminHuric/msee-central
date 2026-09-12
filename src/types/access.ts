/**
 * What one person may actually do.
 *
 * A role is a template, not a verdict. Two people with the same role can end
 * up with completely different access, because a role is where configuration
 * *starts* and the final answer is per person.
 *
 * THE MODEL
 *
 *   role permissions   the union of every role somebody holds
 * + granted            permissions given to this person alone
 * - revoked            permissions taken from this person alone
 * = effective          what the rules read
 *
 * The last line is the important one: `effective` is written to
 * `userPermissions.permissions`, which is the field every security rule
 * already reads. So individual access needed no change to the rules at all —
 * only the flattening had to learn to respect the two override lists.
 *
 * Before this, overrides were not merely missing, they were impossible:
 * recomputing somebody's permissions read the roles and nothing else, so any
 * individual grant was destroyed by the next role edit.
 *
 * WHY TWO LISTS RATHER THAN ONE
 *
 * A single "custom permissions" list would lose the connection to the role.
 * Change the Sales role to add `sales.export` and nobody who had been
 * customised would ever receive it, because their list was frozen the day
 * somebody touched it. With a grant list and a revoke list, the role keeps
 * flowing through and the individual decisions stay on top of it — which is
 * what makes "give Marko projects as well" and "take prices away from Marko"
 * both survive a role change.
 */

/*
 * Type-only, deliberately.
 *
 * A value import here would make this module resolve `./permissions` at
 * runtime, which breaks the tooling that reads these files directly with
 * Node's type stripping. `permissionTree` takes the catalogue as an argument
 * instead, which also makes it a pure function.
 */
import type { Permission } from './permissions'

/**
 * Whose records somebody may see, for a permission that has a scope.
 *
 * Separate from the permission itself, because "may read clients" and "whose
 * clients" are two different questions and folding them together produces the
 * `view_all` pattern — which only has two settings and cannot express a team.
 */
export const SCOPES = ['own', 'team', 'department', 'all'] as const
export type Scope = (typeof SCOPES)[number]

/** How wide each scope is, so a comparison is a number rather than a switch. */
const WIDTH: Record<Scope, number> = { own: 0, team: 1, department: 2, all: 3 }

export const atLeast = (held: Scope, needed: Scope) => WIDTH[held] >= WIDTH[needed]

/**
 * The modules where scope means something.
 *
 * Not every permission has one: `settings.manage` is not narrowed by whose
 * settings they are. Listing the ones that do keeps the editor honest instead
 * of offering a scope picker beside a permission it cannot affect.
 */
export const SCOPED_MODULES = [
  'clients',
  'leads',
  'sales',
  'projects',
  'goals',
  'calendar',
  'wallet',
  'analytics',
  'performance',
] as const
export type ScopedModule = (typeof SCOPED_MODULES)[number]

export interface AccessOverrides {
  /** Given to this person alone, on top of their roles. */
  granted: Permission[]
  /** Taken from this person alone, whatever their roles say. */
  revoked: Permission[]
  /** Whose records they may see, per module. Absent means the role default. */
  scopes: Partial<Record<ScopedModule, Scope>>
}

export const NO_OVERRIDES: AccessOverrides = { granted: [], revoked: [], scopes: {} }

/**
 * Work out what somebody may actually do.
 *
 * Revoke wins over grant. If a permission appears in both lists the answer is
 * no, because the alternative — letting an accidental grant override a
 * deliberate removal — fails in the dangerous direction.
 */
export function effectivePermissions(
  rolePermissions: Permission[],
  overrides: AccessOverrides | null | undefined,
): Permission[] {
  const granted = overrides?.granted ?? []
  const revoked = new Set(overrides?.revoked ?? [])

  const all = new Set<Permission>([...rolePermissions, ...granted])
  for (const permission of revoked) all.delete(permission)

  /* Sorted so the stored array is stable and a diff means a real change. */
  return [...all].sort()
}

/**
 * Where a permission came from, for the screen that explains somebody's access.
 *
 * The CEO needs to be able to tell "this is on because the role says so" from
 * "this is on because I turned it on for this person" — otherwise resetting to
 * the role defaults is a guess.
 */
export type Source = 'role' | 'granted' | 'revoked' | 'off'

export function sourceOf(
  permission: Permission,
  rolePermissions: Permission[],
  overrides: AccessOverrides | null | undefined,
): Source {
  if (overrides?.revoked?.includes(permission)) return 'revoked'
  if (overrides?.granted?.includes(permission)) return 'granted'
  return rolePermissions.includes(permission) ? 'role' : 'off'
}

/**
 * Turn a permission on or off for one person.
 *
 * The two lists are kept minimal rather than exhaustive: turning on something
 * the role already grants records nothing, because there is nothing
 * individual about it. That matters — a list padded with redundant grants
 * would stop the role flowing through, which is the whole point of keeping
 * them separate.
 */
export function toggle(
  permission: Permission,
  on: boolean,
  rolePermissions: Permission[],
  overrides: AccessOverrides,
): AccessOverrides {
  const fromRole = rolePermissions.includes(permission)

  const granted = overrides.granted.filter((p) => p !== permission)
  const revoked = overrides.revoked.filter((p) => p !== permission)

  if (on && !fromRole) granted.push(permission)
  if (!on && fromRole) revoked.push(permission)

  return { ...overrides, granted, revoked }
}

/** Drop every individual decision and fall back to the roles. */
export function resetToRole(overrides: AccessOverrides): AccessOverrides {
  return { ...overrides, granted: [], revoked: [] }
}

/**
 * Permissions grouped for the editor, by module and then by action.
 *
 * Derived from the catalogue rather than written out again, so a permission
 * added to `PERMISSIONS` appears in the editor without a second edit — and
 * cannot be silently missing from it.
 */
export interface PermissionTree {
  module: string
  permissions: Permission[]
  scoped: boolean
}

export function permissionTree(catalogue: readonly Permission[]): PermissionTree[] {
  const byModule = new Map<string, Permission[]>()

  for (const permission of catalogue) {
    /* Every permission is `module.action`; the fallback is unreachable and
       keeps the compiler from having to take that on trust. */
    const module = permission.split('.')[0] ?? permission
    if (!byModule.has(module)) byModule.set(module, [])
    byModule.get(module)!.push(permission)
  }

  const scoped = new Set<string>(SCOPED_MODULES)

  return [...byModule.entries()].map(([module, permissions]) => ({
    module,
    permissions,
    scoped: scoped.has(module),
  }))
}
