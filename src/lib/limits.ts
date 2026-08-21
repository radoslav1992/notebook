import { HttpError } from './db';
import { now } from './ids';
import {
  BUSINESS,
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
      // Библиотеката на организация не се брои в квотата на човека: тя е обща и
      // не е негова, а иначе учителят я плаща от своя таван.
      .prepare("SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ? AND kind = 'personal'")
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

/**
 * Кой плаща въпроса: собственият план или общият пакет на организация.
 * Отчитането (`countQuestion`) трябва да получи същата стойност — иначе
 * въпросът се разрешава от единия джоб, а се удържа от другия.
 */
export type QuestionPayer = { via: 'personal' } | { via: 'org'; orgId: string };

export async function assertCanAsk(db: D1Database, userId: string): Promise<QuestionPayer> {
  const [ent, usage] = await Promise.all([getEntitlement(db, userId), getUsage(db, userId)]);
  const max = ent.plan.limits.questionsPerMonth;
  if (usage.questions < max) return { via: 'personal' };

  // Личната квота е изчерпана. Членството в организация с платени места дава
  // достъп до общия ѝ пакет — нарочно СЛЕД личната квота: безплатните 50 не
  // товарят пакета на екипа, а платеният Плюс не спира да значи нищо.
  const pools = await orgPools(db, userId);
  for (const pool of pools) {
    if (pool.used < pool.total) return { via: 'org', orgId: pool.orgId };
  }

  if (pools.length > 0) {
    throw new QuotaError(
      `Изчерпа ${max} лични въпроса, а общият пакет на организацията също е изчерпан. Броячите се нулират на 1-во число.`,
      ent.plan.id,
    );
  }
  throw new QuotaError(
    `Изчерпа ${max} въпроса за този месец. Броячът се нулира на 1-во число.`,
    ent.plan.id,
  );
}

interface OrgPool {
  orgId: string;
  /** Пакетът: платени места × въпроси на място. */
  total: number;
  used: number;
}

/** Пакетите, до които човекът има достъп — само организации с платени места. */
async function orgPools(db: D1Database, userId: string): Promise<OrgPool[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id AS org_id, o.seats, COALESCE(u.questions, 0) AS used
       FROM org_members m
         JOIN organizations o ON o.id = m.org_id
         LEFT JOIN org_usage_counters u ON u.org_id = o.id AND u.period = ?
       WHERE m.user_id = ? AND o.seats > 0
       ORDER BY o.id`,
    )
    .bind(currentPeriod(), userId)
    .all<{ org_id: string; seats: number; used: number }>();

  return (results ?? []).map((r) => ({
    orgId: r.org_id,
    total: r.seats * BUSINESS.questionsPerSeat,
    used: r.used,
  }));
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

export async function countQuestion(
  db: D1Database,
  userId: string,
  payer: QuestionPayer = { via: 'personal' },
): Promise<void> {
  if (payer.via === 'org') {
    await db
      .prepare(
        `INSERT INTO org_usage_counters (org_id, period, questions) VALUES (?, ?, 1)
         ON CONFLICT(org_id, period) DO UPDATE SET questions = questions + 1`,
      )
      .bind(payer.orgId, currentPeriod())
      .run();
    return;
  }
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

/**
 * Ръчно задаване на план от админ — за сделки по фактура и жестове, преди (и
 * извън) Stripe. Пише същия ред като webhook-а, но без Stripe идентификатори и
 * без часовник: планът важи, докато админ не го смени.
 *
 * Отказва, ако планът се управлява от жив Stripe абонамент: следващото събитие
 * от Stripe така или иначе би презаписало реда, тоест „промяната“ би била лъжа
 * с падеж. Такъв абонамент се сменя през Stripe, не оттук.
 */
export async function adminSetPlan(
  db: D1Database,
  userId: string,
  plan: PlanId,
): Promise<void> {
  const ent = await getEntitlement(db, userId);
  if (ent.stripeSubscriptionId && isActiveStatus(ent.status)) {
    throw new HttpError(
      409,
      'Планът се управлява от Stripe абонамент — смени го през Stripe, иначе следващото му събитие ще презапише ръчната промяна.',
    );
  }
  await saveSubscription(db, userId, {
    plan,
    status: 'active',
    interval: 'month',
    stripeCustomerId: ent.stripeCustomerId,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
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
