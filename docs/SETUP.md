# Пускане на Записки — стъпка по стъпка

Всичко, което трябва да предоставиш, и точните команди за него.

> Ако предпочиташ без терминал — само през dashboard-а на Cloudflare и GitHub —
> виж [`deploy-console.md`](deploy-console.md).

**Съдържание**

1. [Какво ти трябва — кратък списък](#1-какво-ти-трябва)
2. [Локална работа за 5 минути](#2-локална-работа-за-5-минути)
3. [Cloudflare: D1, R2, Vectorize](#3-cloudflare)
4. [Gemini API ключ](#4-gemini-api-ключ)
5. [Влизане с Google](#5-влизане-с-google)
6. [Имейли (Resend)](#6-имейли)
7. [Абонаменти (Stripe)](#7-абонаменти-stripe)
8. [Тайни и променливи — пълен списък](#8-тайни-и-променливи)
9. [Пускане в production](#9-пускане-в-production)
10. [Проверка, че всичко работи](#10-проверка)
11. [Ако нещо не работи](#11-ако-нещо-не-работи)

---

## 1. Какво ти трябва

| # | Ресурс | За какво | Нужен ли е, за да пуснеш? |
| --- | --- | --- | --- |
| 1 | **Gemini API ключ** | отговори, вграждания, подкаст | **Да**, освен ако всички модели са на Cloudflare — виж [models.md](models.md) |
| 2 | **Cloudflare акаунт, Workers Paid** (5 $/мес.) | приложението | **Да** |
| 3 | **D1 база** | тетрадки, източници, разговори | **Да** — но се създава сама при deploy |
| 4 | **R2 кофа** | файловете и аудио прегледите | **Да** — също се създава сама |
| 5 | **Vectorize индекс** | търсенето в източниците | **Да** — това се прави ръчно |
| 6 | **`SESSION_SECRET`** | подписва сесиите | **Да** |
| 7 | **Домейн** | адресът на приложението | Не (има `*.workers.dev`) |
| 8 | **Google OAuth Client** | влизане с Google | Не — без него остава само парола |
| 9 | **Resend акаунт** | потвърждаване на имейл, нова парола | Не — но иначе тези две неща не работят |
| 10 | **Stripe акаунт** | абонаменти | Не — без него всички са на безплатния план |

**Защо Workers Paid, а не безплатният план:** Vectorize го няма в безплатния
план, а безплатните 10 ms CPU на заявка не стигат за разчитане на PDF и
сглобяване на WAV. Платеният дава 30 s.

Приблизителна сметка на месец при малко потребление: Cloudflare 5 $ + Gemini
по потребление (центове при десетки въпроси) + Resend 0 $ до 3000 писма +
Stripe само процент от оборота.

---

## 2. Локална работа за 5 минути

Дотук стига без Google, без Resend и без Stripe:

```bash
npm install
npm run db:migrate:local     # прави таблиците в локалната база (.wrangler/state)

cp .dev.vars.example .dev.vars
# сложи GEMINI_API_KEY и SESSION_SECRET (виж стъпки 4 и 8)

npm run dev                  # http://localhost:4321
```

Без Cloudflare акаунт и без `wrangler login` — локалните D1 и R2 се въртят на
твоята машина.

Какво работи и какво не при това положение:

| Работи | Не работи |
| --- | --- |
| Всички екрани, тетрадки, източници, бележки | Търсенето в източниците (иска Vectorize — стъпка 3) |
| Регистрация с парола и вход | Влизане с Google (стъпка 5) |
| Аудио преглед, мисловна карта | Писма — връзките се показват на екрана вместо да се пращат |
| Плановете и лимитите | Плащане (стъпка 7) |

Връзките за потвърждаване на имейл и за нова парола се връщат в самия отговор и
се показват в интерфейса, докато няма настроен Resend. Това е нарочно, за да е
ползваемо локално.

---

## 3. Cloudflare

### Какво се създава само и какво — не

| Ресурс | Създава се при `wrangler deploy`? |
| --- | --- |
| KV за сесиите на Astro (`SESSION`) | **да** |
| D1 (`zapiski`) | **да** — по име, затова в конфигурацията няма `database_id` |
| R2 (`zapiski-files`) | **да** |
| **Vectorize** (`zapiski-chunks`) | **не** — трябва да се направи ръчно |
| **Таблиците в D1** | **не** — миграциите не са част от deploy |

Тоест при deploy от GitHub оставят две неща за ръчно правене: **Vectorize
индексът** и **миграциите**. И двете са еднократни.

```bash
npx wrangler login
```

### D1 — таблиците

Самата база се създава при първия deploy. Таблиците — не:

```bash
npm run db:migrate:local     # локалната база в .wrangler/state
npm run db:migrate           # истинската (--remote)
```

Ако предпочиташ базата да е фиксирана, а не намирана по име:

```bash
npx wrangler d1 create zapiski
# добави "database_id": "<uuid>" в d1_databases в wrangler.jsonc
```

### R2 — файловете

Създава се сам при deploy. Изрично:

```bash
npx wrangler r2 bucket create zapiski-files
```

### Vectorize — търсенето

Ширината на индекса трябва да съвпада с `EMBED_MODEL`. По подразбиране моделът е
`gemini-embedding-001`: връща 3072 числа, но е трениран да се съкращава без
съществена загуба (Matryoshka), затова приложението иска **1536** и нормализира
наново. При `@cf/baai/bge-m3` числото е **1024** — виж [models.md](models.md).
Ширината се извежда от модела в `src/lib/ai/select.ts`. Двата индекса по
метаданни правят филтрирането по тетрадка и по избрани източници бързо:

```bash
npx wrangler vectorize create zapiski-chunks --dimensions=1536 --metric=cosine
npx wrangler vectorize create-metadata-index zapiski-chunks --propertyName=notebookId --type=string
npx wrangler vectorize create-metadata-index zapiski-chunks --propertyName=sourceId --type=string
```

Индексите по метаданни се правят **преди** първия качен източник: Vectorize
индексира по метаданни само вектори, добавени след тяхното създаване.

> **Vectorize няма локален емулатор.** D1 и R2 се въртят локално в
> `.wrangler/state`, но този binding работи само срещу истинския индекс.
> За да работи търсенето, докато разработваш, разкоментирай `"remote": true`
> в `wrangler.jsonc` (частта `vectorize`). Остава изключено по подразбиране,
> защото с него `astro dev` отказва да стартира, докато не влезеш в
> Cloudflare — а свеж клон трябва да се вдига само с `npm run dev`.

Ако смениш `EMBED_MODEL` или размерността, индексът трябва да се пресъздаде —
Vectorize не мени ширината на съществуващ индекс.

---

## 4. Gemini API ключ

1. Отвори https://aistudio.google.com/apikey
2. **Create API key** — избери или направи Google Cloud проект.
3. Ключът започва с `AIza…`.

Локално го слагаш в `.dev.vars`; за production:

```bash
npx wrangler secret put GEMINI_API_KEY
```

Безплатният лимит на AI Studio е малък. За истинско ползване включи плащане в
Google Cloud проекта, иначе ще получаваш „Достигнат е лимитът на Gemini API“.

Всеки може и да си сложи **свой** ключ от Настройки — пази се в неговия браузър
и се праща само с неговите заявки. Ако сървърът няма ключ, приложението работи
само за хората, които са сложили свой.

---

## 5. Влизане с Google

1. https://console.cloud.google.com → избери проект.
2. **APIs & Services → OAuth consent screen**: тип **External**, попълни име на
   приложението, имейл за поддръжка и лого. Добави си имейла в **Test users**,
   докато приложението е в тестов режим.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized redirect URIs** — добави и двата, точно така:
     ```
     http://localhost:4321/api/auth/google/callback
     https://ТВОЯТ-ДОМЕЙН/api/auth/google/callback
     ```
4. Копирай Client ID и Client secret.

```bash
npx wrangler secret put GOOGLE_CLIENT_ID       # 123-abc.apps.googleusercontent.com
npx wrangler secret put GOOGLE_CLIENT_SECRET   # GOCSPX-…
```

Бутонът „Продължи с Google“ се появява сам, когато и двете са налични.

Преди да пуснеш публично, мини през **Publishing status → Publish app**, иначе
влизат само хората от Test users.

---

## 6. Имейли

Нужни са за две неща: потвърждаване на имейл и нова парола.

1. https://resend.com → регистрация.
2. **Domains → Add domain**: добави домейна си и сложи DNS записите (SPF, DKIM,
   и DMARC, ако Resend го поиска). Без потвърден домейн може да пращаш само до
   собствения си адрес.
3. **API Keys → Create API key**.

```bash
npx wrangler secret put RESEND_API_KEY
```

`EMAIL_FROM` се задава като променлива в `wrangler.jsonc` (`vars`) или като
тайна — адресът трябва да е на потвърдения домейн:

```
EMAIL_FROM = "Записки <zdravey@tvoydomain.bg>"
```

Без `RESEND_API_KEY` профилите се създават, но остават непотвърдени, а „забравена
парола“ не работи — връзките се показват в интерфейса вместо да се пращат.

---

## 7. Абонаменти (Stripe)

### 7.1 Продукти и цени

В https://dashboard.stripe.com (започни в **Test mode**) направи **два
продукта**, всеки с **две** повтарящи се цени в **EUR**:

| Продукт | Цена | Период | Променлива |
| --- | --- | --- | --- |
| Записки Плюс | 9,00 € | месечно | `STRIPE_PRICE_PLUS_MONTH` |
| Записки Плюс | 90,00 € | годишно | `STRIPE_PRICE_PLUS_YEAR` |
| Записки Про | 19,00 € | месечно | `STRIPE_PRICE_PRO_MONTH` |
| Записки Про | 190,00 € | годишно | `STRIPE_PRICE_PRO_YEAR` |

Всяка цена има ID от вида `price_1AbC…` — то отива в съответната променлива.

> Сумите тук трябва да съвпадат с `src/lib/plans.ts`. Stripe взима парите по
> price ID; страницата с цените показва числата от този файл. Разминат ли се,
> ще показваш една цена, а ще таксуваш друга.

### 7.2 Ключ

**Developers → API keys → Secret key** (`sk_test_…`, а после `sk_live_…`):

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

### 7.3 Webhook

Това е задължително: планът се вписва от webhook-а, не от връщането след
плащане (браузърът може и да не стигне дотам).

**Developers → Webhooks → Add endpoint**

- URL: `https://ТВОЯТ-ДОМЕЙН/api/billing/webhook`
- Събития:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

Копирай **Signing secret** (`whsec_…`):

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Локална проверка без публичен адрес:

```bash
stripe listen --forward-to localhost:4321/api/billing/webhook
# сложи показания whsec_… в .dev.vars
```

### 7.4 Портал и данъци

- **Settings → Billing → Customer portal**: включи го и разреши смяна на
  абонамент и отказ. Бутонът „Плащане и фактури“ в Настройки води там.
- **Settings → Tax**: приложението иска `automatic_tax`, така че включи Stripe
  Tax и попълни данъчните си регистрации. Без това Stripe може да отхвърли
  създаването на плащане.

### 7.5 Пробен период (по избор)

```
STRIPE_TRIAL_DAYS = "14"
```

### 7.6 Като си готов за истински пари

Смени `sk_test_…` на `sk_live_…`, направи цените и webhook-а **отново** в live
режим (test и live са отделни светове) и обнови четирите `STRIPE_PRICE_*` и
`STRIPE_WEBHOOK_SECRET`.

---

## 8. Тайни и променливи

### Тайни (`wrangler secret put ИМЕ`)

| Тайна | Задължителна | Откъде |
| --- | --- | --- |
| `GEMINI_API_KEY` | да | aistudio.google.com/apikey |
| `SESSION_SECRET` | да | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` | не | Google Cloud → Credentials |
| `GOOGLE_CLIENT_SECRET` | не | същото място |
| `RESEND_API_KEY` | не | resend.com → API Keys |
| `STRIPE_SECRET_KEY` | не | Stripe → API keys |
| `STRIPE_WEBHOOK_SECRET` | не | Stripe → Webhooks |
| `STRIPE_PRICE_PLUS_MONTH` | не | Stripe → цената |
| `STRIPE_PRICE_PLUS_YEAR` | не | Stripe → цената |
| `STRIPE_PRICE_PRO_MONTH` | не | Stripe → цената |
| `STRIPE_PRICE_PRO_YEAR` | не | Stripe → цената |

> Ако смениш `SESSION_SECRET`, всички сесии падат и всеки трябва да влезе
> отново. Данните остават — сменяй го само нарочно.

### Променливи (`vars` в `wrangler.jsonc`)

| Променлива | По подразбиране | Какво прави |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | адресът на заявката | Базата за връзките в писмата и за OAuth. **Задай го в production**, иначе писмата могат да сочат към грешен адрес. |
| `EMAIL_FROM` | `onboarding@resend.dev` | Подател на писмата. |
| `RAG_BACKEND` | `vectorize` | `vectorize` = собствен индекс; `gemini` = Google File Search. |
| `CHAT_MODEL` | `gemini-2.5-flash` | Модел за отговорите. Името избира и доставчика — виж [models.md](models.md). |
| `CHAT_MODEL_PRO` | `gemini-2.5-pro` | По-добрият модел, който платените планове може да изберат в Настройки. |
| `EMBED_MODEL` | `gemini-embedding-001` | Вграждания; смяната иска нов Vectorize индекс. |
| `EMBED_DIMENSIONS` | по модела | Ширина на вектора, ако моделът не е в таблицата в `ai/select.ts`. |
| `TTS_MODEL` | `gemini-3.1-flash-tts-preview` | Подкастът; трябва да поддържа multi-speaker. Суфиксът `-preview` е част от името. |
| `RESPONSE_LANGUAGE` | `bg` | Език по подразбиране за новите профили. |
| `STRIPE_TRIAL_DAYS` | няма | Дни безплатен пробен период. |

`GEMINI_BASE_URL` и `STRIPE_BASE_URL` съществуват само за тестове — насочват
двете API-та към макет. Не ги задавай в production.

---

## 9. Пускане в production

Два начина. Изберѝ един.

### А) Deploy от GitHub (Cloudflare Workers Builds)

Cloudflare следи хранилището и пуска ново при всяко бутане в основния клон.

1. Cloudflare → **Workers & Pages → Create → Workers → Connect to Git**.
2. Избери хранилището и клона.
3. Командите по подразбиране са правилните — остави ги:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   > Adapter-ът пише `.wrangler/deploy/config.json` при build, откъдето
   > `wrangler deploy` намира worker-а. Нищо не се настройва ръчно.
4. **Тайните НЕ се задават в GitHub.** Променливите от build средата не стигат
   до worker-а по време на работа. Отвори worker-а →
   **Settings → Variables and Secrets → Add → Secret** и добави поне
   `GEMINI_API_KEY` и `SESSION_SECRET`. Остават при следващите deploy-и.
5. Пусни първия deploy. Той създава D1, R2 и KV за сесиите.
6. Еднократно от терминал (Vectorize и таблиците не се създават от deploy):

   ```bash
   npx wrangler login
   npx wrangler vectorize create zapiski-chunks --dimensions=1536 --metric=cosine
   npx wrangler vectorize create-metadata-index zapiski-chunks --propertyName=notebookId --type=string
   npx wrangler vectorize create-metadata-index zapiski-chunks --propertyName=sourceId --type=string
   npm run db:migrate
   ```

Ако искаш и миграциите да минават автоматично, смени Deploy command на:

```
npx wrangler deploy && npx wrangler d1 migrations apply zapiski --remote
```

Работи само ако token-ът на Workers Builds има права да пише в D1. Ако deploy-ът
се счупи с грешка за права, върни командата по подразбиране и пускай
`npm run db:migrate` на ръка при нова миграция.

### Б) Deploy от терминал

```bash
npm run db:migrate          # таблиците в истинската база
npm run deploy              # build + wrangler deploy
```

### И при двата начина, след първия deploy

1. Вземи адреса (`https://zapiski.ТВОЙ-ПОДДОМЕЙН.workers.dev`).
2. Ако имаш домейн: worker-ът → **Settings → Domains & Routes → Add custom
   domain**.
3. Задай `PUBLIC_SITE_URL` на крайния адрес (Variables and Secrets).
4. Добави `https://ТОЗИ-АДРЕС/api/auth/google/callback` в Google Credentials.
5. Насочи Stripe webhook-а към `https://ТОЗИ-АДРЕС/api/billing/webhook`.

---

## 10. Проверка

По ред, всяка стъпка отнема по-малко от минута:

| # | Какво | Очаквано |
| --- | --- | --- |
| 1 | Отвори `/` | Лендингът се зарежда |
| 2 | Отвори `/app` без профил | Пренасочва към `/login?next=%2Fapp` |
| 3 | Направи профил | Влиза направо в `/app`; ако Resend е настроен — идва писмо |
| 4 | „+ Нова тетрадка“, качи PDF | Източникът минава през „чета и индексирам…“ до брой страници |
| 5 | Задай въпрос | Отговор с чипове „1 · име, стр. N“; клик показва пасажа |
| 6 | Направи 4-та тетрадка | Отказ с „Безплатният план стига до 3 тетрадки“ |
| 7 | Излез и влез пак | Тетрадките са там |
| 8 | „Продължи с Google“ | Влиза и свързва същия имейл |
| 9 | Студио → „Създай аудио преглед“ | Напредък, после плейър, който върти |
| 10 | `/pricing` → „Вземи Плюс“ | Stripe Checkout; с тестова карта `4242 4242 4242 4242` |
| 11 | Настройки | „Плюс“, тавани 25 тетрадки, брояч за месеца |
| 12 | Настройки → „Плащане и фактури“ | Порталът на Stripe се отваря |

Ако нещо от 1–6 не мине, проблемът е в Cloudflare или Gemini. 7–8 е Google или
Resend. 10–12 е Stripe.

Стъпка 5 е същинската проверка: чипове с препратки значат, че D1, R2, Vectorize
и Gemini работят заедно.

---

## 11. Ако нещо не работи

| Съобщение | Причина |
| --- | --- |
| `Липсва SESSION_SECRET` | няма `.dev.vars` или тайната не е сложена |
| `Липсва връзка към D1` | пуснато без bindings, или `database_id` не е сменен |
| `Binding VECTORIZE needs to be run remotely` | липсва `wrangler login`, индексът не съществува, или `"remote": true` е още коментирано |
| `astro dev` не стартира | `"remote": true` е включено, но не си влязъл в Cloudflare |
| `Няма Gemini API ключ` | няма нито сървърен ключ, нито ключ в Настройки |
| `Достигнат е лимитът на Gemini API` | безплатният лимит на AI Studio; включи плащане в GCP |
| `В PDF-а няма текстов слой` | сканиран документ; нужен е OCR преди качване |
| Източник остава на „грешка при обработка“ | точната причина е под името му и в `wrangler tail` |
| `redirect_uri_mismatch` от Google | адресът в Credentials не съвпада точно, включително схема и порт |
| Влизането с Google казва „изтече“ | бисквитката със `state` е изтекла (10 мин.) или са изтрити бисквитките |
| Плащането минава, но планът е стар | webhook-ът не стига до сървъра. Провери Stripe → Webhooks → Recent deliveries |
| `Липсва цена за plus/month` | съответната `STRIPE_PRICE_*` не е зададена |
| Писма не идват | няма `RESEND_API_KEY`, или `EMAIL_FROM` не е на потвърден домейн |

Логовете в реално време:

```bash
npx wrangler tail
```

### Поддръжка на базата

Гостите правят по един ред при първо отваряне на `/app`. Празните профили,
които никога не са направили тетрадка, могат да се чистят:

```bash
npx wrangler d1 execute zapiski --remote --command "
  DELETE FROM users
  WHERE is_anonymous = 1
    AND created_at < strftime('%s','now','-30 days') * 1000
    AND id NOT IN (SELECT DISTINCT user_id FROM notebooks)"
```

Изтеклите сесии и еднократните връзки също:

```bash
npx wrangler d1 execute zapiski --remote --command "
  DELETE FROM sessions WHERE expires_at < strftime('%s','now') * 1000;
  DELETE FROM email_tokens WHERE expires_at < strftime('%s','now') * 1000;
  DELETE FROM rate_limits WHERE window_start < strftime('%s','now','-1 day') * 1000"
```
