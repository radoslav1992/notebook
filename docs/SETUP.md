# Пускане на Записки

Всичко, което трябва да предоставиш, и точните команди за него.

---

## 1. Какво ти трябва

| Ресурс | За какво | Как се взима |
| --- | --- | --- |
| **Gemini API ключ** | отговори, вграждания, подкаст | https://aistudio.google.com/apikey |
| **Cloudflare акаунт, Workers Paid** | самото приложение | https://dash.cloudflare.com |
| **D1 база** | тетрадки, източници, пасажи, разговори | команда по-долу |
| **R2 кофа** | оригиналните файлове + аудио прегледите | команда по-долу |
| **Vectorize индекс** | търсене в пасажите | команда по-долу |
| **`SESSION_SECRET`** | подписва бисквитката на сесията | `openssl rand -hex 32` |

**Защо Workers Paid, а не безплатният план:**

- Vectorize го няма в безплатния план.
- Безплатният план дава 10 ms CPU на заявка. Разчитането на 48-страничен PDF и
  сглобяването на WAV минават далеч над това; платеният план дава 30 s.

Ако не искаш Vectorize, мини на `RAG_BACKEND: "gemini"` (стъпка 6) — тогава
търсенето е в Google File Search и остават само D1 и R2.

---

## 2. Създаване на ресурсите

```bash
npm install
npx wrangler login
```

### D1

```bash
npx wrangler d1 create zapiski
```

Копирай `database_id` от изхода в `wrangler.jsonc` на мястото на
`REPLACE_WITH_YOUR_D1_DATABASE_ID`, после създай таблиците:

```bash
npm run db:migrate:local     # локалната база в .wrangler/state
npm run db:migrate           # истинската база (--remote)
```

### R2

```bash
npx wrangler r2 bucket create zapiski-files
```

### Vectorize

`gemini-embedding-001` се свива до 1536 измерения, защото това е таванът на
Vectorize. Двата индекса по метаданни правят филтрирането по тетрадка и по
избрани източници бързо:

```bash
npx wrangler vectorize create zapiski-chunks --dimensions=1536 --metric=cosine
npx wrangler vectorize create-metadata-index zapiski-chunks --property-name=notebookId --type=string
npx wrangler vectorize create-metadata-index zapiski-chunks --property-name=sourceId  --type=string
```

Ако смениш `EMBED_MODEL` или размерността, индексът трябва да се пресъздаде —
Vectorize не мени ширината на съществуващ индекс.

---

## 3. Тайни

За production:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SESSION_SECRET     # openssl rand -hex 32
```

За локална работа направи `.dev.vars` (не влиза в git):

```bash
cp .dev.vars.example .dev.vars
$EDITOR .dev.vars
```

```ini
GEMINI_API_KEY="AIza..."
SESSION_SECRET="дълъг-случаен-низ"
```

Ако смениш `SESSION_SECRET` по-късно, старите бисквитки спират да важат и
всички получават нови, празни профили. Данните в D1 остават, но стават
недостъпни — сменяй го само нарочно.

---

## 4. Локална работа

```bash
npm run dev      # http://localhost:4321
```

D1 и R2 се въртят локално в `.wrangler/state`. **Vectorize няма локален
емулатор** — в `wrangler.jsonc` е с `experimental_remote: true`, тоест dev
сървърът пише в истинския индекс в акаунта ти. Затова `wrangler login` е нужен и
за локална работа.

Ако видиш `Binding VECTORIZE needs to be run remotely`, значи или не си влязъл,
или индексът още не е създаден.

---

## 5. Deploy

```bash
npm run deploy
```

Adapter-ът иска KV namespace за сесиите на Astro (binding `SESSION`) и Cloudflare
го създава сам при първия deploy — няма какво да правиш.

---

## 6. Настройки

`vars` в `wrangler.jsonc`:

| Променлива | По подразбиране | Какво прави |
| --- | --- | --- |
| `RAG_BACKEND` | `vectorize` | `vectorize` = собствен индекс; `gemini` = Google File Search |
| `CHAT_MODEL` | `gemini-2.5-flash` | моделът за отговорите (сменя се и от Настройки) |
| `EMBED_MODEL` | `gemini-embedding-001` | вграждания; смяната иска нов Vectorize индекс |
| `TTS_MODEL` | `gemini-2.5-flash-preview-tts` | подкастът; трябва да поддържа multi-speaker |
| `RESPONSE_LANGUAGE` | `bg` | език по подразбиране за новите профили |

Незадължителни тайни:

| Тайна | Какво прави |
| --- | --- |
| `GEMINI_BASE_URL` | друг адрес за Gemini API — за прокси или за тестове |

### Собствен ключ от браузъра

Екранът с настройки приема Gemini ключ, който се пази в `localStorage` и пътува
само в хедъра `X-Gemini-Key` на заявките на този браузър. Ако сървърът има
`GEMINI_API_KEY`, ключът от браузъра е по избор и има приоритет. Ако сървърът
няма ключ, приложението работи само за хората, които са сложили свой.

---

## 7. Ако нещо не работи

| Съобщение | Причина |
| --- | --- |
| `Липсва SESSION_SECRET` | няма `.dev.vars` или тайната не е сложена |
| `Липсва връзка към D1` | пуснато е без bindings, или `database_id` не е сменен |
| `Binding VECTORIZE needs to be run remotely` | липсва `wrangler login` или индексът не съществува |
| `Няма Gemini API ключ` | няма нито сървърен ключ, нито ключ в Настройки |
| `В PDF-а няма текстов слой` | сканиран документ; нужен е OCR преди качване |
| `Достигнат е лимитът на Gemini API` | rate limit; клиентът вече опитва с изчакване |
| Източник остава на `грешка при обработка` | точната причина е под името му в панела и в `wrangler tail` |

---

## 8. Какво ползваме от Gemini API

Всичко минава през `src/lib/gemini.ts`:

| Възможност | Къде |
| --- | --- |
| `models/*:streamGenerateContent` | отговорите в чата, дума по дума |
| `models/*:generateContent` | учебни материали, мисловна карта, име на тетрадка |
| `models/*:batchEmbedContents` (с резервен `:embedContent`) | вграждане на пасажите и на въпроса |
| `responseModalities: ["AUDIO"]` + `multiSpeakerVoiceConfig` | подкастът с двама водещи |
| `fileData: { fileUri }` | запис на YouTube видео с времеви кодове |
| `inlineData` (audio) | запис на качен аудио файл |
| `fileSearchStores` + инструмент `fileSearch` | само при `RAG_BACKEND: "gemini"` |

Ако Google промени нещо в тези адреси или полета, се пипа само този файл.
