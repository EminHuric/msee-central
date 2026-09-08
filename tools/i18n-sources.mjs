/**
 * One re-export, so the i18n check can import every enum in a single line
 * rather than reaching into six type modules.
 *
 * Kept apart from the check itself because the interesting part of that file
 * is the reasoning, and forty import lines buried it.
 */

export {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  AUDIT_ACTIONS,
  EMPLOYMENT_STATUSES,
} from '../src/types/domain.ts'

export {
  ANNOUNCEMENT_AUDIENCES,
  EVENT_KINDS,
  GOAL_METRICS,
  GOAL_SCOPES,
  GOAL_STATUSES,
  GOAL_VISIBILITY,
  KPI_METRICS,
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
} from '../src/types/company.ts'

export {
  CLIENT_SOURCES,
  CLIENT_STATUSES,
  LEAD_STAGES,
  PRICING_MODELS,
  PRIORITIES,
  PROJECT_STATUSES,
} from '../src/types/business.ts'

export {
  AFFILIATE_TYPES,
  COMMISSION_MODELS,
  COMMISSION_STATUSES,
  CONTACT_CHANNELS,
  PAYMENT_MODELS,
  PAYMENT_STATES,
  SALE_CHANNELS,
  TRANSACTION_CATEGORIES,
  TRANSACTION_TYPES,
} from '../src/types/revenue.ts'

export {
  ACTIVITY_KINDS,
  FIELD_ENTITIES,
  FIELD_TYPES,
  FIELD_VISIBILITY,
  RECOVERABLE,
} from '../src/types/records.ts'

export {
  AWARD_SOURCES,
  AWARD_STATUSES,
  BONUS_AUDIENCES,
  BONUS_METRICS,
  PROGRAMME_STATUSES,
  REWARD_TYPES,
  WORK_STATUSES,
} from '../src/types/rewards.ts'

export { PERMISSION_GROUPS } from '../src/types/permissions.ts'
