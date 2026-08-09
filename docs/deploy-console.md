# Пускане само през браузъра (Cloudflare console)

Без терминал, без `wrangler`, без `git` на твоята машина. Всичко през
dashboard-а на Cloudflare и GitHub.

За варианта с команди виж [`SETUP.md`](SETUP.md).

> **Едно нещо може да не се получи през браузъра:** индексите по метаданни на
> Vectorize (стъпка 5в). Приложението работи и без тях, но търсенето се влошава,
> когато индексът порасне. Прочети стъпката, преди да я прескочиш.

---

## 0. Преди да започнеш

- Cloudflare акаунт с **Workers Paid** (5 $/мес.). Vectorize го няма в
  безплатния план, а разчитането на PDF надхвърля безплатните 10 ms CPU.
- Gemini API ключ от https://aistudio.google.com/apikey (започва с `AIza…`).
- Дълъг случаен низ за `SESSION_SECRET`. Ако няма как да пуснеш
  `openssl rand -hex 32`, свърши работа всеки низ от 50+ случайни знака —
  например от менажер на пароли.
- Клонът `main` да съдържа всичко. Ако PR-ът за махане на `database_id` още не
  е слян, слей го — иначе deploy-ът пада.

Ресурсите се създават **преди** първия deploy. Така worker-ът ги намира по име
и нищо не зависи от автоматичното създаване.

---

## 1. D1 — базата

1. Cloudflare dashboard → **Storage & Databases → D1 SQL Database**.
2. **Create database**.
3. Name: `zapiski` — точно това име, така е в `wrangler.jsonc`.
4. **Create**.

## 2. Таблиците в D1

Създаването на базата не прави таблици.

1. Отвори базата `zapiski` → таб **Console**.
2. Отвори [`migrations/console-schema.sql`](../migrations/console-schema.sql) в
   GitHub, натисни **Copy raw file** и постави всичко в полето.
3. **Execute**.
4. В таб **Tables** трябва да се появят 17 таблици: `users`, `sessions`,
   `notebooks`, `sources`, `chunks`, `messages`, `citations`, `notes`,
   `studio_jobs`, `mindmaps`, `settings`, `subscriptions`, `usage_counters`,
   `email_tokens`, `rate_limits`, `stripe_events`, `d1_migrations`.

Файлът е генериран от миграциите и накрая ги отбелязва като приложени в
`d1_migrations`, за да не се пуснат втори път отвън.

> Ако някой ден добавя нова миграция, ще ти кажа. Тогава пускаш само нейния
> SQL в същата конзола.

## 3. R2 — файловете

1. Ляво меню → **R2 Object Storage**. Ако е първи път, натисни бутона за
   активиране (иска добавен начин на плащане).
2. **Create bucket**.
3. Name: `zapiski-files`. Location: **Automatic** (или EU, ако искаш данните да
   останат в Европа).
4. **Create bucket**.

## 4. Vectorize — търсенето

### 4а. Индексът

1. **Storage & Databases → Vectorize**.
2. **Create index**.
3. Name: `zapiski-chunks`
4. **Dimensions: 1536** — това е таванът на Vectorize и точно затова
   вгражданията се свиват до 1536. Различно число няма да работи.
5. **Metric: cosine**
6. **Create**.

### 4б. Ако няма бутон „Create index“

Тогава индексът може да се направи с една заявка към API-то, която пускаш от
конзолата на браузъра (F12 → Console), докато си отворил dashboard-а. Трябват
ти Account ID (вижда се вдясно на Workers страницата) и API token с права
**Vectorize: Edit** от **My Profile → API Tokens → Create Token**:

```js
await fetch(
  'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/vectorize/v2/indexes',
  {
    method: 'POST',
    headers: {
      Authorization: 'Bearer API_TOKEN',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'zapiski-chunks',
      config: { dimensions: 1536, metric: 'cosine' },
    }),
  },
).then((r) => r.json()).then(console.log);
```

### 4в. Индексите по метаданни — прочети това

Vectorize позволява филтриране само по свойства, за които има индекс по
метаданни. Приложението филтрира по `notebookId` и `sourceId`.

**Ако тези два индекса липсват**, приложението не се чупи: заявката с филтър
пада, кодът минава на резервния път — взима 60 най-близки пасажа от целия
индекс и отсява чуждите в паметта. Работи, докато индексът е малък.

**Проблемът се появява с растежа.** При много тетрадки 60-те най-близки пасажа
може да са изцяло от чужди тетрадки и отговорът да излезе „в източниците няма
отговор“, макар да има. Тоест за истинска употреба тези индекси трябват.

През браузъра, същият начин като 4б (по един на заявка):

```js
for (const property of ['notebookId', 'sourceId']) {
  const res = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/vectorize/v2/indexes/zapiski-chunks/metadata_index/create',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer API_TOKEN',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ propertyName: property, indexType: 'string' }),
    },
  );
  console.log(property, await res.json());
}
```

Двата индекса трябва да се направят **преди** да качиш източници. Vectorize
индексира по метаданни само вектори, добавени след създаването им.

---

## 5. Worker-ът от GitHub

1. **Workers & Pages → Create → Workers → Import a repository**
   (или **Connect to Git**).
2. Дай достъп до `radoslav1992/notebook` и я избери.
3. Branch: `main`
4. Build settings — стойностите по подразбиране са верните:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   > Adapter-ът записва `.wrangler/deploy/config.json` при build, откъдето
   > `wrangler deploy` намира worker-а. Няма какво да се настройва.
5. **Save and Deploy**.

Worker-ът се казва `zapiski` — идва от `wrangler.jsonc`, независимо какво име
предлага формата.

Първият build отнема 1–2 минути. Ако падне, отвори **Deployments → View
build** и виж лога.

При успех приложението вече е на адрес
`https://zapiski.ТВОЙ-ПОДДОМЕЙН.workers.dev`, но **още не работи** — липсват
тайните. Отваряш и виждаш съобщение за липсващ `SESSION_SECRET`. Това е нормално.

---

## 6. Тайните

**Тук е най-честата грешка.** Ключът не се слага в GitHub. Променливите от build
средата не стигат до worker-а по време на работа.

1. Worker-ът `zapiski` → **Settings → Variables and Secrets**.
2. **+ Add** → Type: **Secret** → за всяка от двете:

   | Name | Value |
   | --- | --- |
   | `GEMINI_API_KEY` | ключът от AI Studio (`AIza…`) |
   | `SESSION_SECRET` | дългият случаен низ |

3. **Deploy** — Cloudflare пуска нова версия с тях.

Тайните остават при следващите deploy-и от GitHub. Не се показват след
записване; при загуба се задава нова стойност.

---

## 7. Адресът

Приложението праща писма и връща от Google по адреса си, така че той трябва да
е известен.

1. Ако имаш домейн: worker-ът → **Settings → Domains & Routes → Add → Custom
   domain**, въведи го и изчакай сертификата.
2. Отвори `wrangler.jsonc` в GitHub, натисни ✏️ и разкоментирай реда, като
   сложиш крайния адрес:

   ```jsonc
   "PUBLIC_SITE_URL": "https://zapiski.tvoydomain.bg",
   ```

3. **Commit changes** директно в `main`. Cloudflare сам пуска нов deploy.

> Защо не в **Variables and Secrets**: стойностите от `vars` в `wrangler.jsonc`
> заместват обикновените променливи в dashboard-а при всеки deploy. Ако ти е
> по-удобно през dashboard-а, добави го като **Secret** — тайните не се
> заместват.

---

## 8. Проверка

Отвори адреса и мини по ред:

| # | Какво | Очаквано |
| --- | --- | --- |
| 1 | `/` | Лендингът се зарежда |
| 2 | `/app` | „Здравей“ и лента „Работиш като гост“ |
| 3 | „+ Нова тетрадка“, качи PDF | Източникът минава от „чета и индексирам…“ до брой страници |
| 4 | Задай въпрос | Отговор с чипове „1 · име, стр. N“; клик показва пасажа |
| 5 | Четвърта тетрадка | Отказ: „Безплатният план стига до 3 тетрадки“ |
| 6 | „Направи профил“ | Тетрадките остават; връзката за потвърждаване се показва на екрана (няма Resend) |
| 7 | Студио → „Създай аудио преглед“ | Напредък, после плейър, който върти |

Стъпка 4 е същинската проверка: ако там има чипове с препратки, значи D1,
R2, Vectorize и Gemini работят заедно.

Ако нещо се счупи: worker-ът → **Logs → Begin log stream**, после повтори
действието в приложението. Съобщенията са на български и казват какво липсва.

---

## 9. По желание, по-късно

Всичко долу е незадължително и приложението работи без него.

| Какво | Какво дава | Къде |
| --- | --- | --- |
| **Google вход** | бутон „Продължи с Google“ | [SETUP.md §5](SETUP.md#5-влизане-с-google), после двете стойности като Secret |
| **Resend** | истински писма за потвърждаване и нова парола | [SETUP.md §6](SETUP.md#6-имейли) |
| **Stripe** | платени планове | [SETUP.md §7](SETUP.md#7-абонаменти-stripe) |

За Google не забравяй да добавиш точния redirect адрес:
`https://ТВОЯТ-АДРЕС/api/auth/google/callback`

За Stripe — webhook към `https://ТВОЯТ-АДРЕС/api/billing/webhook`. Без webhook
плащането минава, но планът не се сменя.

---

## 10. Поддръжка през конзолата

Профилите на гости, които никога не са направили тетрадка, могат да се чистят
от **D1 → zapiski → Console**:

```sql
DELETE FROM users
WHERE is_anonymous = 1
  AND created_at < strftime('%s','now','-30 days') * 1000
  AND id NOT IN (SELECT DISTINCT user_id FROM notebooks);

DELETE FROM sessions WHERE expires_at < strftime('%s','now') * 1000;
DELETE FROM email_tokens WHERE expires_at < strftime('%s','now') * 1000;
DELETE FROM rate_limits WHERE window_start < strftime('%s','now','-1 day') * 1000;
```
