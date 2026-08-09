/**
 * Плановете на едно място: какво влиза, колко струва, какво ограничава.
 *
 * Цените тук се показват на страницата с цените; истинската сума я взима
 * Stripe от price ID-то. Ако смениш цена в Stripe, смени я и тук.
 */

export type PlanId = 'free' | 'plus' | 'pro';
export type BillingInterval = 'month' | 'year';

/** Броят източници в тетрадка е обещание на продукта, еднакъв за всички. */
export const SOURCES_PER_NOTEBOOK = 50;

export interface PlanLimits {
  /** Колко тетрадки може да съществуват едновременно. */
  notebooks: number;
  /** Въпроси в чата на календарен месец. */
  questionsPerMonth: number;
  /** Аудио прегледи на календарен месец. */
  audioPerMonth: number;
  /** Най-дългият аудио преглед в минути. */
  audioMinutes: number;
  /** Достъп до по-скъпия модел. */
  proModel: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Месечна цена в стотинки/центове; `null` за безплатния план. */
  monthly: number | null;
  /** Годишна цена — два месеца по-малко от дванадесет месечни. */
  yearly: number | null;
  limits: PlanLimits;
  /** Каквото се изброява на страницата с цените. */
  features: string[];
  /** Подчертаният план. */
  featured?: boolean;
}

export const CURRENCY = 'eur';
export const CURRENCY_SYMBOL = '€';

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Безплатен',
    tagline: 'За да пробваш с истински документи.',
    monthly: null,
    yearly: null,
    limits: {
      notebooks: 3,
      questionsPerMonth: 50,
      audioPerMonth: 1,
      audioMinutes: 5,
      proModel: false,
    },
    features: [
      'До 3 тетрадки',
      `До ${SOURCES_PER_NOTEBOOK} източника в тетрадка`,
      '50 въпроса на месец',
      '1 аудио преглед на месец (до 5 мин.)',
      'Отговори с препратка до страница',
      'Учебно ръководство, хронология, отчет, въпроси',
    ],
  },
  plus: {
    id: 'plus',
    name: 'Плюс',
    tagline: 'За студент или изследовател, който работи всеки ден.',
    monthly: 900,
    yearly: 9000,
    limits: {
      notebooks: 25,
      questionsPerMonth: 1000,
      audioPerMonth: 20,
      audioMinutes: 12,
      proModel: true,
    },
    features: [
      'До 25 тетрадки',
      `До ${SOURCES_PER_NOTEBOOK} източника в тетрадка`,
      '1000 въпроса на месец',
      '20 аудио прегледа на месец (до 12 мин.)',
      'Gemini Pro за по-точни отговори',
      'Мисловна карта по всички източници',
    ],
    featured: true,
  },
  pro: {
    id: 'pro',
    name: 'Про',
    tagline: 'За екипи и хора с много паралелни теми.',
    monthly: 1900,
    yearly: 19000,
    limits: {
      notebooks: Number.POSITIVE_INFINITY,
      questionsPerMonth: 5000,
      audioPerMonth: 100,
      audioMinutes: 12,
      proModel: true,
    },
    features: [
      'Неограничени тетрадки',
      `До ${SOURCES_PER_NOTEBOOK} източника в тетрадка`,
      '5000 въпроса на месец',
      '100 аудио прегледа на месец (до 12 мин.)',
      'Gemini Pro за по-точни отговори',
      'Приоритет при обработката на източници',
    ],
  },
};

export const PAID_PLANS: PlanId[] = ['plus', 'pro'];

export function planOf(id: string | null | undefined): Plan {
  if (id === 'plus' || id === 'pro') return PLANS[id];
  return PLANS.free;
}

/** Статуси, при които платеният план още важи. */
export function isActiveStatus(status: string): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

/** „€9“ / „€9,00“ — цените са цели, затова стотинките се крият. */
export function formatPrice(cents: number): string {
  const whole = cents / 100;
  const text = Number.isInteger(whole)
    ? String(whole)
    : whole.toFixed(2).replace('.', ',');
  return `${CURRENCY_SYMBOL}${text}`;
}

export function monthlyEquivalent(plan: Plan): string | null {
  if (plan.yearly === null) return null;
  return formatPrice(Math.round(plan.yearly / 12));
}

/** Кое Stripe price ID отговаря на план и период. */
export function priceIdFor(
  env: Record<string, string | undefined>,
  plan: PlanId,
  interval: BillingInterval,
): string | undefined {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval === 'year' ? 'YEAR' : 'MONTH'}`;
  return env[key];
}

/** Обратното: от price ID към план и период — ползва се от webhook-а. */
export function planFromPriceId(
  env: Record<string, string | undefined>,
  priceId: string,
): { plan: PlanId; interval: BillingInterval } | null {
  for (const plan of PAID_PLANS) {
    for (const interval of ['month', 'year'] as BillingInterval[]) {
      if (priceIdFor(env, plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
}

/** Периодът за месечните броячи: „2026-08“. */
export function currentPeriod(at = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}
