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
  /**
   * Най-дългият аудио преглед в минути.
   *
   * Кратко нарочно: TTS-ът се плаща на секунда изговорен звук (~$0.015 на
   * минута), тоест дължината е почти цялата сметка за тази функция. Освен това
   * дълъг преглед значи много TTS извиквания в едно изпълнение на worker-а —
   * точно това забиваше задачите. Два минутен преглед е 1–2 извиквания.
   */
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
      audioPerMonth: 3,
      audioMinutes: 2,
      proModel: false,
    },
    features: [
      'До 3 тетрадки',
      `До ${SOURCES_PER_NOTEBOOK} източника в тетрадка`,
      '50 въпроса на месец',
      '3 аудио прегледа на месец (по 2 мин.)',
      'Отговори с препратка до страница',
      'Резюме, хронология, отчет, въпроси',
    ],
  },
  plus: {
    id: 'plus',
    name: 'Плюс',
    tagline: 'За човек, който работи с документи всеки ден.',
    monthly: 900,
    yearly: 9000,
    limits: {
      notebooks: 25,
      questionsPerMonth: 1000,
      audioPerMonth: 20,
      audioMinutes: 2,
      proModel: false,
    },
    features: [
      'До 25 тетрадки',
      `До ${SOURCES_PER_NOTEBOOK} източника в тетрадка`,
      '1000 въпроса на месец',
      '20 аудио прегледа на месец (по 2 мин.)',
      'Мисловна карта по всички източници',
      'Търсене и по дума, и по смисъл',
    ],
    featured: true,
  },
  pro: {
    id: 'pro',
    name: 'Про',
    tagline: 'За много паралелни теми и по-дълги прегледи.',
    monthly: 1900,
    yearly: 19000,
    limits: {
      notebooks: Number.POSITIVE_INFINITY,
      questionsPerMonth: 2000,
      audioPerMonth: 40,
      audioMinutes: 4,
      proModel: false,
    },
    features: [
      'Неограничени тетрадки',
      `До ${SOURCES_PER_NOTEBOOK} източника в тетрадка`,
      '2000 въпроса на месец',
      '40 аудио прегледа на месец (по 4 мин.)',
      'Двойно по-дълги аудио прегледи',
      'Приоритет при обработката на източници',
    ],
  },
};

/**
 * Бизнес планът — за организация с обща библиотека.
 *
 * НЕ е част от `PlanId` нарочно. Цената е на място и се плаща по фактура, а
 * `subscriptions` е таблица с един ред на потребител: няма къде да живее план,
 * който се брои по места, и няма Stripe поток, който да го таксува. Влезеше ли в
 * `PlanId`, щеше да се появи в проверките за лимити и в webhook-а като нещо, което
 * може да бъде активно — а то не може.
 *
 * Затова тук стои само това, което страницата с цените показва. Организациите се
 * създават от Настройки и работят; сметката засега се води извън приложението.
 */
export const BUSINESS = {
  name: 'Бизнес',
  tagline: 'За екип, катедра или клас с обща библиотека.',
  /** Цена на място, месечно, в стотинки/центове. */
  perSeatMonthly: 400,
  minSeats: 10,
  /** Въпроси на място, месечно — общи за организацията. */
  questionsPerSeat: 300,
  features: [
    'Обща библиотека: качваш веднъж, ползват всички',
    '€4 на място месечно, минимум 10 места',
    '300 въпроса на място, общи за екипа',
    'Роли: собственик, администратор, член',
    'Покани по имейл',
    'Плащане по фактура',
  ],
} as const;

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
