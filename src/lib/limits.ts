import { HttpError } from './db';
import { now } from './ids';
import {
  type BillingInterval,
  type Plan,
  type PlanId,
  currentPeriod,
  isActiveStatus,
  planOf,
} from './plans';

/** Абонаментът, както го вижда приложението. */
export interface Entitlement {
  plan: Plan;
  status: string;
  interval: BillingInterval;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface Usage {
  period: string;
  questions: number;
  audio: number;
  notebooks: number;
}

interface SubRow {
  plan: string;
  status: string;
  interval: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
}

/**
 * Липсващ ред означава безплатен план — не създаваме редове, докато някой не
 * плати. Изтекъл или отказан абонамент също пада на безплатния план.
 */
export async function getEntitlement(db: D1Database, userId: string): Promise<Entitlement> {
  const row = await db
    .prepare(
      `SELECT plan, status, interval, stripe_customer_id, stripe_subscription_id,
              current_period_end, cancel_at_period_end
       FROM subscriptions WHERE user_id = ?`,
    )
    .bind(userId)
    .first<SubRow>();

  if (!row) {
    return {
      plan: planOf('free'),
      status: 'active',
      interval: 'month',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    };
  }

  const stillPaid =
    isActiveStatus(row.status) &&
    // Stripe праща `canceled` при край, но пазим и часовника като защита.
    (row.current_period_end === null || row.current_period_end > now() - 86_400_000);

  return {
    plan: planOf(stillPaid ? row.plan : 'free'),
    status: row.status,
    interval: row.interval === 'year' ? 'year' : 'month',
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

export async function getUsage(db: D1Database, userId: string): Promise<Usage> {
  const period = currentPeriod();
  const [counters, notebooks] = await Promise.all([
    db
      .prepare('SELECT questions, audio FROM usage_counters WHERE user_id = ? AND period = ?')
      .bind(userId, period)
      .first<{ questions: number; audio: number }>(),
    db
      .prepare('SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ?')
      .bind(userId)
      .first<{ c: number }>(),
  ]);
  return {
    period,
    questions: counters?.questions ?? 0,
    audio: counters?.audio ?? 0,
    notebooks: notebooks?.c ?? 0,
  };
}

/* ── Проверки ────────────────────────────────────────────────────────────── */

/**
 * Отказва с 402, когато лимитът на плана е достигнат. 402 е сигналът, по който
 * интерфейсът показва „Виж плановете“ вместо обикновена грешка.
 */
export class QuotaError extends HttpError {
  constructor(
    message: string,
    readonly plan: PlanId,
  ) {
    super(402, message);
    this.name = 'QuotaError';
  }
}

export async function assertCanCreateNotebook(
  db: D1Database,
  userId: string,
): Promise<void> {
  const [ent, usage] = await Promise.all([getEntitlement(db, userId), getUsage(db, userId)]);
  const max = ent.plan.limits.notebooks;
  if (usage.notebooks >= max) {
    throw new QuotaError(
      max === 3
        ? 'Безплатният план стига до 3 тетрадки. Изтрий една или вземи Плюс.'
        : `Планът ${ent.plan.name} стига до ${max} тетрадки.`,
      ent.plan.id,
    );
  }
}

export async function assertCanAsk(db: D1Database, userId: string): Promise<void> {
  const [ent, usage] = await Promise.all([getEntitlement(db, userId), getUsage(db, userId)]);
  const max = ent.plan.limits.questionsPerMonth;
  if (usage.questions >= max) {
    throw new QuotaError(
      `Изчерпа ${max} въпроса за този месец. Броячът се нулира на 1-во число.`,
      ent.plan.id,
    );
  }
}

export async function assertCanMakeAudio(db: D1Database, userId: string): Promise<void> {
  const [ent, usage] = await Promise.all([getEntitlement(db, userId), getUsage(db, userId)]);
  const max = ent.plan.limits.audioPerMonth;
  if (usage.audio >= max) {
    // Числото идва от плана, не от прилагателно: „един“ спираше да е вярно още
    // при първата промяна на безплатния таван.
    throw new QuotaError(
      max === 1
        ? 'Планът ти дава един аудио преглед на месец.'
        : `Изчерпа ${max} аудио прегледа за този месец.`,
      ent.plan.id,
    );
  }
}

/* ── Отчитане ────────────────────────────────────────────────────────────── */

export async function countQuestion(db: D1Database, userId: string): Promise<void> {
  await bump(db, userId, 'questions');
}

export async function countAudio(db: D1Database, userId: string): Promise<void> {
  await bump(db, userId, 'audio');
}

async function bump(db: D1Database, userId: string, column: 'questions' | 'audio'): Promise<void> {
  // Колоната идва от литерален тип, не от вход на потребителя.
  await db
    .prepare(
      `INSERT INTO usage_counters (user_id, period, ${column}) VALUES (?, ?, 1)
       ON CONFLICT(user_id, period) DO UPDATE SET ${column} = ${column} + 1`,
    )
    .bind(userId, currentPeriod())
    .run();
}

/* ── Записване от Stripe ─────────────────────────────────────────────────── */

export async function saveSubscription(
  db: D1Database,
  userId: string,
  input: {
    plan: PlanId;
    status: string;
    interval: BillingInterval;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subscriptions (user_id, plan, status, interval, stripe_customer_id,
                                  stripe_subscription_id, current_period_end,
                                  cancel_at_period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         plan = excluded.plan,
         status = excluded.status,
         interval = excluded.interval,
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
         stripe_subscription_id = excluded.stripe_subscription_id,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      input.plan,
      input.status,
      input.interval,
      input.stripeCustomerId,
      input.stripeSubscriptionId,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd ? 1 : 0,
      now(),
    )
    .run();
}

export async function findUserByCustomerId(
  db: D1Database,
  customerId: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?')
    .bind(customerId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/** Stripe праща едно и също събитие повече от веднъж; това го прави безвредно. */
export async function markEventProcessed(
  db: D1Database,
  id: string,
  type: string,
): Promise<boolean> {
  try {
    const res = await db
      .prepare('INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)')
      .bind(id, type, now())
      .run();
    return Boolean(res.meta.changes);
  } catch {
    // Нарушен уникален ключ = вече е обработено.
    return false;
  }
}
