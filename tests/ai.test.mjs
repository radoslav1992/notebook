import assert from 'node:assert/strict';

const { providerFor, usesGeminiShape, bodyShapeFor, dimensionsFor, isMultilingualEmbed } = await import(
  '../src/lib/ai/select.ts'
);
const { modelChoices, resolveChatModel, labelFor, FALLBACK_CHAT_MODEL } = await import(
  '../src/lib/ai/choices.ts'
);
const { CloudflareAi } = await import('../src/lib/ai/cloudflare.ts');
const { buildAi } = await import('../src/lib/ai/index.ts');
const { googleTts } = await import('../src/lib/ai/google.ts');
const { AiError } = await import('../src/lib/ai/error.ts');
const { vectorError, isDimensionMismatch } = await import('../src/lib/vector.ts');
const { FALLBACK_EMBED_MODEL, FALLBACK_TTS_MODEL } = await import('../src/lib/ai/defaults.ts');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const at = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

/** Binding, който записва какво е получил и връща каквото му кажем. */
function stubAi(reply) {
  const calls = [];
  return {
    calls,
    run(model, input) {
      calls.push({ model, input });
      const out = typeof reply === 'function' ? reply(model, input, calls.length) : reply;
      if (out instanceof Error) return Promise.reject(out);
      return Promise.resolve(out);
    },
  };
}

const geminiReply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });

/** Хвърлената грешка, за да може съобщението ѝ да се провери. */
function caught(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new assert.AssertionError({ message: 'очаквах грешка, но нямаше' });
}

/* ── кой доставчик ────────────────────────────────────────────────────────── */

console.log('provider from the model name');

t('a name without a slash is Google, with a slash is Cloudflare', () => {
  assert.equal(providerFor('gemini-2.5-flash'), 'google');
  assert.equal(providerFor('gemini-embedding-001'), 'google');
  assert.equal(providerFor('google/gemini-3.6-flash'), 'cloudflare');
  assert.equal(providerFor('google/gemini-3.1-flash-tts'), 'cloudflare');
  assert.equal(providerFor('@cf/baai/bge-m3'), 'cloudflare');
  assert.equal(providerFor('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), 'cloudflare');
});

t('only the google/* partner models take the Gemini body shape', () => {
  assert.equal(usesGeminiShape('google/gemini-3.6-flash'), true);
  assert.equal(usesGeminiShape('@cf/baai/bge-m3'), false);
  assert.equal(usesGeminiShape('gemini-2.5-flash'), false);
});

t('three body shapes, not two — openai/* is the Responses API', () => {
  // Подадени грешни полета, моделът не гърми: тихо игнорира тавана и
  // температурата. Затова разликата се пази в тест.
  assert.equal(bodyShapeFor('google/gemini-3.6-flash'), 'gemini');
  assert.equal(bodyShapeFor('openai/gpt-5.6-luna'), 'responses');
  assert.equal(bodyShapeFor('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), 'messages');
  assert.equal(bodyShapeFor('@cf/baai/bge-m3'), 'messages');
});

t('the label keeps acronyms upper-case', () => {
  // „Gpt 5.6 Luna“ изглежда като печатна грешка в падащото меню.
  assert.equal(labelFor('openai/gpt-5.6-luna'), 'GPT 5.6 Luna — през Cloudflare');
});

t('vector width follows the embedding model, and can be forced', () => {
  assert.equal(dimensionsFor('gemini-embedding-001'), 1536);
  assert.equal(dimensionsFor('@cf/baai/bge-m3'), 1024);
  assert.equal(dimensionsFor('@cf/baai/bge-small-en-v1.5'), 384);
  // Непознат модел не бива да мълчи с грешно число — пада на подразбиране,
  // а override-ът е за точно този случай.
  assert.equal(dimensionsFor('@cf/someone/brand-new'), 1536);
  assert.equal(dimensionsFor('@cf/someone/brand-new', '768'), 768);
  assert.equal(dimensionsFor('@cf/baai/bge-m3', 'глупости'), 1024);
});

t('bge-m3 is the only Cloudflare embedding model fit for Bulgarian', () => {
  assert.equal(isMultilingualEmbed('@cf/baai/bge-m3'), true);
  assert.equal(isMultilingualEmbed('@cf/baai/bge-large-en-v1.5'), false);
  assert.equal(isMultilingualEmbed('gemini-embedding-001'), true);
});

/* ── сглобяване ───────────────────────────────────────────────────────────── */

console.log('\nbuilding the three roles');

t('each role goes where its own model name points', () => {
  const ai = buildAi({
    chatModel: 'google/gemini-3.6-flash',
    embedModel: 'gemini-embedding-001',
    ttsModel: 'google/gemini-3.1-flash-tts',
    googleKey: 'k',
    ai: stubAi(geminiReply('x')),
  });
  assert.equal(ai.chat.model, 'google/gemini-3.6-flash');
  assert.equal(ai.embed.model, 'gemini-embedding-001');
  assert.equal(ai.embed.dimensions, 1536);
  assert.equal(ai.tts.model, 'google/gemini-3.1-flash-tts');
  assert.ok(ai.google, 'ключът за Google е подаден, значи Google-only пътищата работят');
});

t('everything on Cloudflare needs no Google key at all', () => {
  const ai = buildAi({
    chatModel: 'google/gemini-3.6-flash',
    embedModel: '@cf/baai/bge-m3',
    ttsModel: 'google/gemini-3.1-flash-tts',
    ai: stubAi(geminiReply('x')),
  });
  assert.equal(ai.embed.dimensions, 1024);
  assert.equal(ai.google, null, 'без ключ няма клиент на Google');
});

t('a Google model without a key names the role that wants it', () => {
  const err = caught(() =>
    buildAi({
      chatModel: 'gemini-2.5-flash',
      embedModel: '@cf/baai/bge-m3',
      ttsModel: 'google/gemini-3.1-flash-tts',
      ai: stubAi(null),
    }),
  );
  assert.ok(err instanceof AiError, 'AiError, за да стигне до потребителя преведена');
  assert.match(err.message, /чата/);
  assert.match(err.message, /GEMINI_API_KEY/);
});

t('a Cloudflare model without the binding says which line to add', () => {
  const err = caught(() =>
    buildAi({
      chatModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      embedModel: 'gemini-embedding-001',
      ttsModel: 'gemini-3.1-flash-tts-preview',
      googleKey: 'k',
    }),
  );
  assert.ok(err instanceof AiError);
  assert.match(err.message, /"ai": \{ "binding": "AI" \}/);
});

/* ── тялото на заявките ───────────────────────────────────────────────────── */

console.log('\nrequest bodies');

await at('google/* gets Gemini`s shape: contents + systemInstruction', async () => {
  const ai = stubAi(geminiReply('Отговор.'));
  const cf = new CloudflareAi({ ai, model: 'google/gemini-3.6-flash' });
  const text = await cf.generateText({ prompt: 'Въпрос?', systemInstruction: 'Бъди кратък.' });

  assert.equal(text, 'Отговор.');
  const { input } = ai.calls[0];
  assert.deepEqual(input.contents, [{ role: 'user', parts: [{ text: 'Въпрос?' }] }]);
  assert.deepEqual(input.systemInstruction, { parts: [{ text: 'Бъди кратък.' }] });
  assert.ok(!('messages' in input), 'не бива да носи и двете форми');
});

await at('@cf/* gets messages, with the instruction as a system turn', async () => {
  const ai = stubAi({ response: 'Отговор.' });
  const cf = new CloudflareAi({ ai, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
  const text = await cf.generateText({
    prompt: 'Въпрос?',
    systemInstruction: 'Бъди кратък.',
    config: { temperature: 0.2, maxOutputTokens: 512 },
  });

  assert.equal(text, 'Отговор.');
  const { input } = ai.calls[0];
  assert.deepEqual(input.messages, [
    { role: 'system', content: 'Бъди кратък.' },
    { role: 'user', content: 'Въпрос?' },
  ]);
  assert.equal(input.temperature, 0.2);
  assert.equal(input.max_tokens, 512, 'maxOutputTokens се превежда на max_tokens');
  assert.ok(!('contents' in input));
});

await at('JSON се измъква и когато моделът го обгради с проза', async () => {
  const ai = stubAi({ response: 'Ето го:\n```json\n{"title":"Тема"}\n```' });
  const cf = new CloudflareAi({ ai, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
  assert.deepEqual(await cf.generateJson({ prompt: 'x', schema: {} }), { title: 'Тема' });
});

/* ── вграждания ───────────────────────────────────────────────────────────── */

console.log('\nembeddings');

await at('@cf embeddings send {text} and come back normalised', async () => {
  const ai = stubAi({ data: [[3, 4]] });
  const cf = new CloudflareAi({ ai, model: '@cf/baai/bge-m3', dimensions: 1024 });
  const [vec] = await cf.embed(['пасаж']);

  assert.deepEqual(ai.calls[0].input, { text: ['пасаж'] });
  // 3,4 → дължина 5 → 0.6, 0.8; Vectorize с cosine очаква единична дължина.
  assert.deepEqual(vec, [0.6, 0.8]);
});

await at('a short vector batch is an error, not silently misaligned data', async () => {
  const ai = stubAi({ data: [[1, 0]] });
  const cf = new CloudflareAi({ ai, model: '@cf/baai/bge-m3' });
  // Мълчаливото подравняване тук би вкарало вектор под чужд id в индекса.
  await assert.rejects(() => cf.embed(['а', 'б']), /1 вектора за 2 пасажа/);
});

await at('a google/* model refuses to embed and names the model that can', async () => {
  const cf = new CloudflareAi({ ai: stubAi(null), model: 'google/gemini-3.6-flash' });
  await assert.rejects(() => cf.embed(['а']), /@cf\/baai\/bge-m3/);
});

/* ── реч ──────────────────────────────────────────────────────────────────── */

console.log('\nspeech');

await at('two hosts become multiSpeakerVoiceConfig, audio comes back as PCM', async () => {
  const ai = stubAi({
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AQIDBA==' } }],
        },
      },
    ],
  });
  const cf = new CloudflareAi({ ai, model: 'google/gemini-3.1-flash-tts' });
  const { pcm, sampleRate } = await cf.speak({
    text: 'Ния: Здравей.\nСтефан: Здравей.',
    speakers: [
      { name: 'Ния', voice: 'Kore' },
      { name: 'Стефан', voice: 'Puck' },
    ],
  });

  assert.deepEqual([...pcm], [1, 2, 3, 4]);
  assert.equal(sampleRate, 24_000);
  const cfg = ai.calls[0].input.generationConfig;
  assert.deepEqual(cfg.responseModalities, ['AUDIO']);
  const voices = cfg.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
  assert.equal(voices.length, 2);
  assert.equal(voices[0].speaker, 'Ния');
  assert.equal(voices[1].voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
});

await at('Cloudflare`s own TTS models refuse, because none of them speaks Bulgarian', async () => {
  // MeloTTS: en/es/fr/zh/ja/ko. Deepgram Aura: en/es. Български няма в нито един,
  // а и връщат MP3, докато подкастът се сглобява от сурово PCM.
  for (const model of ['@cf/myshell-ai/melotts', '@cf/deepgram/aura-1']) {
    const cf = new CloudflareAi({ ai: stubAi(null), model });
    await assert.rejects(() => cf.speak({ text: 'Здравей' }), /google\/gemini-3.1-flash-tts/);
  }
});

/* ── непознат TTS модел ───────────────────────────────────────────────────── */

console.log('\nunknown tts model');

/** Колкото от `Gemini` ползва googleTts. */
function fakeGemini({ ttsModel, speakError, models }) {
  return {
    ttsModel,
    speak: () => Promise.reject(speakError),
    listModels: () =>
      models instanceof Error ? Promise.reject(models) : Promise.resolve(models),
  };
}

await at('a missing TTS model comes back listing the ones the key accepts', async () => {
  // Точният отговор на Google за име, взето от блог вместо от ListModels.
  const notFound = new AiError(
    404,
    'Моделът не съществува или не е достъпен за този ключ. Google отговори: models/gemini-3.1-flash-tts is not found for API version v1beta',
  );
  const tts = googleTts(
    fakeGemini({
      ttsModel: 'gemini-3.1-flash-tts',
      speakError: notFound,
      models: [
        { id: 'gemini-3.6-flash', displayName: '', description: '', methods: ['generateContent'] },
        { id: 'gemini-3.1-flash-tts-preview', displayName: '', description: '', methods: ['generateContent'] },
        { id: 'gemini-3.5-flash-tts-preview', displayName: '', description: '', methods: ['generateContent'] },
      ],
    }),
  );

  const err = await tts.speak({ text: 'Здравей' }).then(() => null, (e) => e);
  assert.ok(err instanceof AiError, 'остава AiError, за да стигне преведена');
  assert.match(err.message, /TTS_MODEL/);
  assert.match(err.message, /gemini-3.1-flash-tts-preview/);
  assert.match(err.message, /gemini-3.5-flash-tts-preview/);
  // Само TTS моделите, иначе списъкът е безполезен.
  assert.ok(!err.message.includes('gemini-3.6-flash'), err.message);
});

await at('a key with no speech model at all says exactly that', async () => {
  const tts = googleTts(
    fakeGemini({
      ttsModel: 'gemini-3.1-flash-tts-preview',
      speakError: new AiError(404, 'model is not found'),
      models: [{ id: 'gemini-3.6-flash', displayName: '', description: '', methods: ['generateContent'] }],
    }),
  );
  const err = await tts.speak({ text: 'x' }).then(() => null, (e) => e);
  assert.match(err.message, /нито един TTS модел/);
});

await at('errors that are not about a missing model pass through untouched', async () => {
  const quota = new AiError(429, 'Достигнат е лимитът на Gemini API. Опитай пак след малко.');
  const tts = googleTts(
    fakeGemini({ ttsModel: 'x', speakError: quota, models: new Error('да не се вика') }),
  );
  const err = await tts.speak({ text: 'x' }).then(() => null, (e) => e);
  assert.equal(err, quota, 'не бива да се пипа, нито да се пита за списък');
});

await at('a failing model list leaves the original error, not one about the list', async () => {
  const notFound = new AiError(404, 'model is not found');
  const tts = googleTts(
    fakeGemini({ ttsModel: 'x', speakError: notFound, models: new Error('ListModels падна') }),
  );
  const err = await tts.speak({ text: 'x' }).then(() => null, (e) => e);
  assert.equal(err, notFound);
});

/* ── стрийминг ────────────────────────────────────────────────────────────── */

console.log('\nstreaming');

await at('a model that rejects stream:true is asked once more without it', async () => {
  const ai = stubAi((_model, input) =>
    input.stream ? new Error('400 Bad Request: stream is not supported') : geminiReply('Целият текст.'),
  );
  const cf = new CloudflareAi({ ai, model: 'google/no-stream-test' });

  const out = [];
  for await (const part of cf.stream({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] })) {
    out.push(part.text);
  }
  assert.deepEqual(out, ['Целият текст.']);
  assert.equal(ai.calls.length, 2, 'един опит със stream, един без');

  // Вторият въпрос към същия модел вече не хаби опит.
  for await (const _ of cf.stream({ contents: [{ role: 'user', parts: [{ text: 'y' }] }] })) { /* ok */ }
  assert.equal(ai.calls.length, 3, 'запомнено: повече не се пробва със stream');
  assert.ok(!ai.calls[2].input.stream);
});

await at('an SSE stream is read frame by frame in both shapes', async () => {
  const frames = [
    'data: {"response":"Пър"}\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"во "}]}}]}\n',
    'data: {"response":"второ"}\n',
    'data: [DONE]\n',
  ];
  const ai = stubAi(
    () =>
      new ReadableStream({
        start(c) {
          for (const f of frames) c.enqueue(new TextEncoder().encode(f));
          c.close();
        },
      }),
  );
  const cf = new CloudflareAi({ ai, model: 'google/streams-test' });

  let text = '';
  for await (const part of cf.stream({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] })) {
    text += part.text;
  }
  assert.equal(text, 'Първо второ');
});

/* ── избор в Настройки ────────────────────────────────────────────────────── */

console.log('\nmodel choices');

t('the picker offers what the deployment configured, not a hardcoded list', () => {
  const cfg = { chatModel: 'google/gemini-3.6-flash', chatModelPro: '@cf/meta/llama-4-scout' };
  const choices = modelChoices(cfg);
  assert.deepEqual(choices.map((c) => c.value), [
    'google/gemini-3.6-flash',
    '@cf/meta/llama-4-scout',
  ]);
  assert.deepEqual(choices.map((c) => c.pro), [false, true]);
});

t('one model configured means one option, never a duplicate', () => {
  assert.equal(modelChoices({ chatModel: 'a/b' }).length, 1);
  assert.equal(modelChoices({ chatModel: 'a/b', chatModelPro: 'a/b' }).length, 1);
});

t('the pro model is refused on a free plan, and unknown values fall back', () => {
  const cfg = { chatModel: 'google/gemini-3.6-flash', chatModelPro: 'google/gemini-3.6-pro' };
  assert.equal(resolveChatModel(cfg, 'google/gemini-3.6-pro', true), 'google/gemini-3.6-pro');
  assert.equal(resolveChatModel(cfg, 'google/gemini-3.6-pro', false), 'google/gemini-3.6-flash');
  // Стойност от базата, останала от предишна конфигурация, не бива да отива
  // към доставчик, който вече не се ползва.
  assert.equal(resolveChatModel(cfg, 'gemini-2.5-flash', true), 'google/gemini-3.6-flash');
  assert.equal(resolveChatModel(cfg, '', true), 'google/gemini-3.6-flash');
  assert.equal(resolveChatModel(cfg, null, true), 'google/gemini-3.6-flash');
});

t('the built-in default is a model new keys can still use', () => {
  // gemini-2.5-flash отговаря „no longer available to new users“ на нов ключ,
  // тоест стойност по подразбиране от 2.5 значи неработеща инсталация.
  assert.ok(!FALLBACK_CHAT_MODEL.startsWith('gemini-2.5'), FALLBACK_CHAT_MODEL);
  assert.equal(modelChoices({}).length, 1);
  assert.equal(modelChoices({})[0].value, FALLBACK_CHAT_MODEL);
  assert.equal(resolveChatModel({}, 'gemini-2.5-flash', true), FALLBACK_CHAT_MODEL);
});

t('the default TTS id keeps its -preview suffix and is not from 2.5', () => {
  // Двете начина, по които това вече се обърка: „Gemini 3.1 Flash TTS“ в API-то е
  // `gemini-3.1-flash-tts-preview` (без суфикса → „is not found“), а цялото 2.5
  // семейство отпадна, включително `gemini-2.5-flash-preview-tts`.
  assert.ok(FALLBACK_TTS_MODEL.includes('tts'), FALLBACK_TTS_MODEL);
  assert.ok(!FALLBACK_TTS_MODEL.startsWith('gemini-2.5'), FALLBACK_TTS_MODEL);
  assert.ok(/-preview$/.test(FALLBACK_TTS_MODEL), 'суфиксът е част от името');
});

t('with no variables set at all, the defaults still make a working setup', () => {
  // wrangler.jsonc нарочно не задава vars — иначе deploy заменя стойностите от
  // dashboard-а. Значи стойностите по подразбиране в кода са единственото, което
  // държи свеж клон да работи.
  const ai = buildAi({
    chatModel: FALLBACK_CHAT_MODEL,
    embedModel: FALLBACK_EMBED_MODEL,
    ttsModel: FALLBACK_TTS_MODEL,
    googleKey: 'k',
  });
  assert.equal(ai.chat.model, FALLBACK_CHAT_MODEL);
  assert.equal(ai.embed.dimensions, 1536, 'трябва да съвпада с индекса от SETUP.md');
  assert.ok(ai.google, 'нито един по подразбиране не иска Workers AI binding');
});

console.log('\nembedding width vs the index');

t('a dimension mismatch says what to do, not just that Vectorize refused', () => {
  // Смяна на EMBED_MODEL от dashboard-а изглежда безобидна и чупи търсенето:
  // индекс не се преоразмерява.
  const raw = new Error('Vector dimension mismatch: expected 1536, got 1024');
  assert.equal(isDimensionMismatch(raw), true);
  const out = vectorError(raw, 1024).message;
  assert.match(out, /1024 измерения/);
  assert.match(out, /EMBED_MODEL/);
  assert.match(out, /нов индекс/);
  assert.match(out, /expected 1536/, 'оригиналът остава за диагностика');
});

t('other Vectorize failures are passed through unchanged', () => {
  const other = new Error('Metadata index not found for property notebookId');
  assert.equal(isDimensionMismatch(other), false);
  assert.equal(vectorError(other, 1536), other, 'същият обект, не пренаписан');
});

t('labels say the model and where it runs', () => {
  // Точката е част от версията: „3.1“ не бива да става „3 1“.
  assert.equal(labelFor('google/gemini-3.1-flash-tts'), 'Gemini 3.1 Flash TTS — през Cloudflare');
  assert.equal(labelFor('gemini-2.5-flash'), 'Gemini 2.5 Flash — през Google');
  assert.equal(
    labelFor('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    'Llama 3.3 70b Instruct FP8 Fast — през Cloudflare',
  );
  assert.match(labelFor('@cf/baai/bge-m3'), /през Cloudflare$/);
});

/* ── Responses API (openai/*) ─────────────────────────────────────────────── */

await at('an openai/* model gets input + instructions + max_output_tokens', async () => {
  const ai = stubAi({
    output: [
      { type: 'reasoning', content: [] },
      { type: 'message', content: [{ type: 'output_text', text: 'Отговор.' }] },
    ],
  });
  const cf = new CloudflareAi({ ai, model: 'openai/gpt-5.6-luna' });
  const text = await cf.generateText({
    prompt: 'Въпрос?',
    systemInstruction: 'Бъди кратък.',
    config: { maxOutputTokens: 512, temperature: 0.35 },
  });

  assert.equal(text, 'Отговор.', 'текстът се чете от втория елемент, не от първия');

  const { input } = ai.calls[0];
  assert.deepEqual(input.input, [{ role: 'user', content: 'Въпрос?' }]);
  assert.equal(input.instructions, 'Бъди кратък.');
  assert.equal(input.max_output_tokens, 512, 'не max_tokens');
  assert.equal(input.messages, undefined, 'формата за @cf/* не бива да изтича тук');
  assert.equal(input.contents, undefined, 'нито тази за google/*');
  // Токените за мислене се таксуват като изход, тоест неограничено мислене е
  // неограничена сметка за нещо, което потребителят не чете.
  assert.equal(input.reasoning?.effort, 'low');
});

await at('reasoning items before the message do not swallow the answer', async () => {
  // Точният случай, който би дал празен отговор, ако се вземе „първият елемент“.
  const ai = stubAi({
    output: [
      { type: 'reasoning' },
      { type: 'message', content: [{ type: 'output_text', text: 'Част 1. ' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'Част 2.' }] },
    ],
  });
  const cf = new CloudflareAi({ ai, model: 'openai/gpt-5.6-luna' });
  assert.equal(await cf.generateText({ prompt: 'х' }), 'Част 1. Част 2.');
});

await at('the Gemini and @cf shapes still get their own bodies', async () => {
  const g = stubAi({ candidates: [{ content: { parts: [{ text: 'G' }] } }] });
  await new CloudflareAi({ ai: g, model: 'google/gemini-3.6-flash' }).generateText({
    prompt: 'х',
    config: { maxOutputTokens: 99 },
  });
  assert.equal(g.calls[0].input.generationConfig.maxOutputTokens, 99);
  assert.equal(g.calls[0].input.input, undefined);

  const c = stubAi({ response: 'C' });
  await new CloudflareAi({ ai: c, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }).generateText({
    prompt: 'х',
    config: { maxOutputTokens: 99 },
  });
  assert.equal(c.calls[0].input.max_tokens, 99, '@cf/* ползва max_tokens');
  assert.equal(c.calls[0].input.max_output_tokens, undefined);
});

await at('a 7003 routing error names the model instead of guessing', async () => {
  // Точното съобщение от Cloudflare при сгрешено име на модел.
  const ai = { run: async () => { throw new Error('7003: User Input Error'); } };
  const cf = new CloudflareAi({ ai, model: 'openai/gpt-5.6-luna' });
  const err = await cf.generateText({ prompt: 'х' }).then(() => null, (e) => e);

  assert.ok(err, 'трябва да хвърли');
  assert.equal(err.status, 404, '7003 е „няма такъв адрес“, не 502');
  assert.ok(err.message.includes('openai/gpt-5.6-luna'), 'трябва да каже КОЙ модел: ' + err.message);
  assert.ok(/Models|\/api\/models/.test(err.message), 'и къде да се провери: ' + err.message);
});

await at('any other Workers AI failure still names the model and the shape', async () => {
  // Иначе човекът гадае между три роли (чат, вграждания, реч) и три форми.
  const ai = { run: async () => { throw new Error('something odd happened'); } };
  const cf = new CloudflareAi({ ai, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
  const err = await cf.generateText({ prompt: 'х' }).then(() => null, (e) => e);
  assert.ok(err.message.includes('@cf/meta/llama-3.3-70b-instruct-fp8-fast'), err.message);
  assert.ok(err.message.includes('messages'), 'формата също: ' + err.message);
});

console.log('\n' + pass + ' checks passed');
