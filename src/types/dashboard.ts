/**
 * What a person chooses to see on their own dashboard.
 *
 * The CEO watches the company; a salesperson watches their pipeline; somebody
 * in finance watches what has not been paid. One fixed dashboard serves the
 * first of those and wastes the screen of the other two.
 *
 * THE RULE THAT MATTERS: choosing a widget can never widen what somebody is
 * allowed to see. Each widget below names the permission that opens it, and
 * that permission is checked when the dashboard renders — not only when the
 * picker is drawn. A layout is a preference, and a preference is not a grant.
 *
 * Three layers hold that up, in increasing order of how much they are worth:
 *
 *   1. the picker only offers widgets the person holds the permission for
 *   2. the dashboard filters the saved layout through the same check, so a
 *      layout saved before a permission was withdrawn stops rendering it
 *   3. the data behind every widget comes from Firestore, which enforces the
 *      same permission in its rules — so a layout edited by hand in the
 *      database renders an empty widget rather than somebody else's figures
 *
 * Only the third is a real defence. The first two exist so the screen is
 * honest, not so it is safe.
 */

import { PERMISSIONS, type Permission } from './permissions'

export interface WidgetDef {
  id: string
  /** i18n key for the name shown in the picker. */
  labelKey: string
  /**
   * What a person must hold to see it. `null` means anybody signed in — their
   * own work, which needs no permission because it is theirs.
   */
  permission: Permission | null
  /** Rendered at full width rather than in the grid. */
  wide?: boolean
}

/**
 * Every widget the dashboard can draw, in the order a new person gets them.
 *
 * Adding one here is the whole job: the picker, the layout, and the permission
 * check all read this list.
 */
export const WIDGETS: WidgetDef[] = [
  /* ---- What needs doing --------------------------------------------- */
  { id: 'alerts', labelKey: 'widget.alerts', permission: null, wide: true },
  { id: 'today', labelKey: 'widget.today', permission: null, wide: true },
  { id: 'quickActions', labelKey: 'widget.quickActions', permission: null },

  /* ---- Money --------------------------------------------------------- */
  { id: 'money', labelKey: 'widget.money', permission: PERMISSIONS.FINANCE_VIEW, wide: true },
  { id: 'moneyChart', labelKey: 'widget.moneyChart', permission: PERMISSIONS.FINANCE_VIEW },
  { id: 'byService', labelKey: 'widget.byService', permission: PERMISSIONS.FINANCE_VIEW },
  { id: 'bySource', labelKey: 'widget.bySource', permission: PERMISSIONS.FINANCE_VIEW },

  /* ---- The business -------------------------------------------------- */
  { id: 'work', labelKey: 'widget.work', permission: null, wide: true },
  { id: 'salesAndLeads', labelKey: 'widget.salesAndLeads', permission: PERMISSIONS.SALES_VIEW },
  { id: 'goals', labelKey: 'widget.goals', permission: PERMISSIONS.GOALS_VIEW },
  { id: 'activity', labelKey: 'widget.activity', permission: null },
]

export const WIDGET_IDS = WIDGETS.map((w) => w.id)

export interface DashboardLayout {
  uid: string
  /** Widget ids, in the order they are drawn. Absent means hidden. */
  visible: string[]
  updatedAt: string
}

/** What somebody sees before they have chosen anything. */
export function defaultLayout(uid: string): DashboardLayout {
  return { uid, visible: [...WIDGET_IDS], updatedAt: '' }
}

/**
 * The layout actually drawn: saved order, minus anything the viewer may not
 * see, minus anything that no longer exists.
 *
 * The second filter is the one with teeth. A layout saved while somebody held
 * `finance.view` keeps naming the money widgets after the permission is taken
 * away, and without this it would keep drawing them.
 */
export function resolveLayout(
  layout: DashboardLayout | null,
  holds: (permission: Permission) => boolean,
): WidgetDef[] {
  const chosen = layout?.visible ?? WIDGET_IDS
  const byId = new Map(WIDGETS.map((w) => [w.id, w]))

  return chosen
    .map((id) => byId.get(id))
    .filter((w): w is WidgetDef => !!w)
    .filter((w) => w.permission === null || holds(w.permission))
}

/** Widgets a person could add: everything they may see, in the canonical order. */
export function availableWidgets(holds: (permission: Permission) => boolean): WidgetDef[] {
  return WIDGETS.filter((w) => w.permission === null || holds(w.permission))
}
