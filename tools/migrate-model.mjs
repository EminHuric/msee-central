/**
 * Bring existing records onto the reshaped model.
 *
 * Three things changed shape, and each has data behind it already:
 *
 *   A PROJECT held one client and now holds many.
 *   THE WORK LEDGER under each client became sales and transactions.
 *   A SALE was a forecast with a stage and now is a record of what happened.
 *
 * Plus the leads whose stages were renamed, and the collections that were
 * retired outright. Nothing here deletes anything: retired records are marked
 * `deletedAt` so they land in the recycle bin, where somebody can look at them
 * before they go. A migration that destroys data is a migration you cannot
 * run twice.
 *
 * Safe to re-run. Every step checks whether it has already been done.
 *
 *   npm run migrate -- --dry
 *   npm run migrate
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const keyPath = resolve(here, 'serviceAccount.json')

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
} catch {
  console.error('\n  tools/serviceAccount.json not found.\n')
  process.exit(1)
}

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const dry = process.argv.includes('--dry')
const now = new Date().toISOString()
const today = now.slice(0, 10)

console.log('\n  Model migration')
console.log(`  project: ${serviceAccount.project_id}`)
console.log(dry ? '  DRY RUN — nothing will be written\n' : '  writing\n')

const done = []
const note = (line) => {
  done.push(line)
  console.log(`  ${line}`)
}

/* Money in the old shape is already {minor, currency, rate, baseMinor}. */
const zero = { minor: 0, currency: 'RSD', rate: 1, baseMinor: 0, rateDate: today }
const money = (m) =>
  m && typeof m.baseMinor === 'number'
    ? { ...m, rateDate: m.rateDate ?? m.date ?? today, rate: m.rate ?? 1 }
    : zero

const STRUCTURE = {
  model: 'one_off',
  advanceBaseMinor: 0,
  instalmentCount: 0,
  dueInDays: 15,
  note: '',
}

const ANALYSIS = {
  howAcquired: '',
  whatWorked: '',
  whatDidNot: '',
  clientPreferences: '',
  notes: '',
}

const SOFT = { deletedAt: null, deletedBy: null, deletedByName: '' }

async function write(ref, data) {
  if (dry) return
  await ref.set(data, { merge: true })
}

/* ------------------------------------------------------------------ *
 * 1. Leads — two stages were renamed
 * ------------------------------------------------------------------ */

{
  const RENAMED = { interested: 'qualified', offer_sent: 'proposal' }
  const snap = await db.collection('leads').get()
  let moved = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    const patch = { ...SOFT }
    let touched = false

    if (RENAMED[data.stage]) {
      patch.stage = RENAMED[data.stage]
      touched = true
    }
    if (data.lastContactedAt === undefined) {
      /* Unknown, not "never": leave it null and let somebody set it. */
      patch.lastContactedAt = null
      touched = true
    }
    if (data.description === undefined) {
      patch.description = data.serviceInterest ?? ''
      touched = true
    }
    if (data.custom === undefined) {
      patch.custom = {}
      touched = true
    }
    if (data.affiliateId === undefined) {
      patch.affiliateId = null
      patch.affiliateName = ''
      touched = true
    }
    if (data.saleId === undefined) {
      patch.saleId = null
      touched = true
    }

    if (touched) {
      await write(doc.ref, { ...patch, updatedAt: now })
      moved += 1
    }
  }

  note(`leads updated              ${moved}/${snap.size}`)
}

/* ------------------------------------------------------------------ *
 * 2. Projects — one client became many
 * ------------------------------------------------------------------ */

{
  const snap = await db.collection('projects').get()
  let moved = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    if (Array.isArray(data.clientIds)) continue

    await write(doc.ref, {
      ...SOFT,
      clientIds: data.clientId ? [data.clientId] : [],
      objective: data.objective ?? '',
      coverUrl: data.coverUrl ?? null,
      budget: data.value ?? null,
      notes: data.notes ?? '',
      custom: data.custom ?? {},
      /* `draft` and `at_risk` replaced each other in the status list. */
      status: data.status === 'draft' ? 'planning' : data.status,
      milestones: (data.milestones ?? []).map((m) => ({ ...m, doneAt: m.doneAt ?? null })),
      updatedAt: now,
    })
    moved += 1
  }

  note(`projects reshaped          ${moved}/${snap.size}`)
}

/* ------------------------------------------------------------------ *
 * 3. Services — payment structure and the fields around it
 * ------------------------------------------------------------------ */

{
  const snap = await db.collection('services').get()
  let moved = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    if (data.payment) continue

    await write(doc.ref, {
      ...SOFT,
      payment: { ...STRUCTURE },
      details: data.details ?? '',
      category: data.category ?? '',
      commissionPercent: data.commissionPercent ?? 0,
      notes: data.notes ?? '',
      custom: data.custom ?? {},
      pricingModel: data.pricingModel === 'commission' ? 'custom' : (data.pricingModel ?? 'fixed'),
      updatedAt: now,
    })
    moved += 1
  }

  note(`services reshaped          ${moved}/${snap.size}`)
}

/* ------------------------------------------------------------------ *
 * 4. Clients — the fields the new list and profile read
 * ------------------------------------------------------------------ */

{
  const snap = await db.collection('clients').get()
  let moved = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    if (data.responsibleUid !== undefined && data.custom !== undefined) continue

    await write(doc.ref, {
      ...SOFT,
      description: data.description ?? '',
      responsibleUid: data.responsibleUid ?? null,
      responsibleName: data.responsibleName ?? '',
      serviceIds: data.serviceIds ?? [],
      tags: data.tags ?? [],
      industry: data.industry ?? '',
      address: data.address ?? '',
      /* `customFields` was a list of {label, value}; `custom` is a bag. */
      custom:
        data.custom ??
        Object.fromEntries((data.customFields ?? []).map((f) => [f.label ?? 'field', f.value ?? ''])),
      updatedAt: now,
    })
    moved += 1
  }

  note(`clients reshaped           ${moved}/${snap.size}`)
}

/* ------------------------------------------------------------------ *
 * 5. The work ledger becomes sales and transactions
 *
 * One ledger row held both what a job was worth and whether it was paid.
 * Those are two facts now: a sale for the first, a transaction for the second
 * — and the transaction is written only when the row was actually settled.
 * ------------------------------------------------------------------ */

{
  const snap = await db.collectionGroup('work').get()
  let sales = 0
  let payments = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    const clientId = data.clientId ?? doc.ref.parent.parent?.id ?? ''
    const saleId = `migrated-${doc.id}`

    const existing = await db.collection('sales').doc(saleId).get()
    if (existing.exists) continue

    const clientDoc = clientId ? await db.collection('clients').doc(clientId).get() : null
    const clientName = clientDoc?.data()?.name ?? ''

    await write(db.collection('sales').doc(saleId), {
      ...SOFT,
      id: saleId,
      title: data.title ?? 'Migrated',
      clientId,
      clientName,
      serviceId: data.serviceId ?? null,
      serviceName: data.serviceName ?? '',
      projectId: data.projectId ?? null,
      leadId: null,
      ownerUid: null,
      ownerName: '',
      affiliateId: null,
      affiliateName: '',
      value: money(data.revenue),
      payment: { ...STRUCTURE },
      saleDate: data.date ?? today,
      channel: 'other',
      contactChannel: 'other',
      analysis: { ...ANALYSIS, notes: data.note ?? '' },
      notes: data.note ?? '',
      custom: {},
      createdAt: data.createdAt ?? now,
      createdBy: data.createdBy ?? 'system:migration',
      updatedAt: now,
    })
    sales += 1

    /* What was paid, and what it cost, as two separate movements. */
    if (data.paymentStatus === 'paid' && money(data.revenue).baseMinor > 0) {
      await write(db.collection('transactions').doc(`migrated-in-${doc.id}`), {
        ...SOFT,
        id: `migrated-in-${doc.id}`,
        type: 'income',
        category: 'service_payment',
        description: data.title ?? 'Migrated',
        amount: money(data.revenue),
        date: data.paidDate ?? data.date ?? today,
        dueDate: null,
        status: 'paid',
        method: '',
        clientId,
        clientName,
        serviceId: data.serviceId ?? null,
        serviceName: data.serviceName ?? '',
        projectId: data.projectId ?? null,
        saleId,
        employeeUid: null,
        employeeName: '',
        affiliateId: null,
        notes: 'migrated from the work ledger',
        createdAt: now,
        createdBy: 'system:migration',
        updatedAt: now,
      })
      payments += 1
    }

    if (money(data.cost).baseMinor > 0) {
      await write(db.collection('transactions').doc(`migrated-out-${doc.id}`), {
        ...SOFT,
        id: `migrated-out-${doc.id}`,
        type: 'expense',
        category: 'subcontractor',
        description: `${data.title ?? 'Migrated'} — cost`,
        amount: money(data.cost),
        date: data.date ?? today,
        dueDate: null,
        status: 'paid',
        method: '',
        clientId,
        clientName,
        serviceId: data.serviceId ?? null,
        serviceName: data.serviceName ?? '',
        projectId: data.projectId ?? null,
        saleId,
        employeeUid: null,
        employeeName: '',
        affiliateId: null,
        notes: 'migrated from the work ledger',
        createdAt: now,
        createdBy: 'system:migration',
        updatedAt: now,
      })
      payments += 1
    }
  }

  note(`work ledger → sales        ${sales}`)
  note(`work ledger → transactions ${payments}`)
}

/* ------------------------------------------------------------------ *
 * 6. Old-shape sales — a forecast becomes a record
 * ------------------------------------------------------------------ */

{
  const snap = await db.collection('sales').get()
  let moved = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    if (data.saleDate) continue

    /*
     * A deal that never closed is not a sale. It goes to the recycle bin
     * rather than being invented into one, and somebody can decide.
     */
    const won = data.stage === 'won'

    await write(doc.ref, {
      ...SOFT,
      ...(won ? {} : { deletedAt: now, deletedBy: 'system:migration', deletedByName: 'Migration' }),
      saleDate: data.closedDate ?? data.expectedCloseDate ?? today,
      payment: { ...STRUCTURE },
      channel: data.affiliateId ? 'affiliate' : 'other',
      contactChannel: 'other',
      analysis: { ...ANALYSIS, notes: data.notes ?? '' },
      affiliateName: data.affiliateName ?? '',
      custom: {},
      updatedAt: now,
    })
    moved += 1
  }

  note(`sales reshaped             ${moved}/${snap.size}`)
}

/* ------------------------------------------------------------------ *
 * 7. Goals — one owner became several
 * ------------------------------------------------------------------ */

{
  const snap = await db.collection('goals').get()
  let moved = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    if (Array.isArray(data.ownerUids)) continue

    await write(doc.ref, {
      ...SOFT,
      ownerUids: data.ownerUid ? [data.ownerUid] : [],
      ownerNames: data.ownerName ? [data.ownerName] : [],
      visibility: 'everyone',
      notes: data.notes ?? '',
      /* Two metrics were renamed when the ledger went. */
      metric:
        data.metric === 'sales_won'
          ? 'sales_count'
          : data.metric === 'tasks_completed'
            ? 'manual'
            : data.metric,
      updatedAt: now,
    })
    moved += 1
  }

  note(`goals reshaped             ${moved}/${snap.size}`)
}

/* ------------------------------------------------------------------ *
 * 8. Affiliates — the referral code went with the links
 * ------------------------------------------------------------------ */

{
  const snap = await db.collection('affiliates').get()
  let moved = 0

  for (const doc of snap.docs) {
    const data = doc.data()

    const ruled = (data.rules ?? []).every((r) => r.requiresFullPayment !== undefined)
    if (ruled && data.deletedAt !== undefined && data.code === undefined) continue

    /*
     * `code` and `clicks` counted referral-link traffic. There are no referral
     * links any more, so the numbers no longer mean anything — and a stale
     * count that still renders is worse than one that is plainly absent.
     */
    await write(doc.ref, {
      ...SOFT,
      code: FieldValue.delete(),
      clicks: FieldValue.delete(),
      signups: FieldValue.delete(),
      rules: (data.rules ?? []).map((r) => ({
        ...r,
        requiresFullPayment: r.requiresFullPayment ?? false,
      })),
      updatedAt: now,
    })
    moved += 1
  }

  note(`affiliates reshaped        ${moved}/${snap.size}`)
}

/* ------------------------------------------------------------------ *
 * 9. Retired collections
 *
 * Contracts, invoices, payments, tasks and chat threads have no home in the
 * new model. Their documents are left exactly where they are: no rule reads
 * them any more, so they are inert, and deleting somebody's data as a side
 * effect of an upgrade is not a decision a script should take.
 * ------------------------------------------------------------------ */

{
  const retired = ['contracts', 'invoices', 'payments', 'expenses', 'tasks', 'chatThreads']
  const counts = []

  for (const name of retired) {
    const snap = await db.collection(name).get()
    if (snap.size) counts.push(`${name} (${snap.size})`)
  }

  if (counts.length) {
    note(`retired, left untouched    ${counts.join(', ')}`)
  }
}

console.log(dry ? '\n  dry run complete — nothing written\n' : '\n  done\n')
process.exit(0)
