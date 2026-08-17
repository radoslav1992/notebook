import { useState } from 'preact/hooks';
import { apiSend } from '~/lib/client';
import { USE_CASES } from '~/lib/prompts';

/**
 * Питането „за какво ще го ползваш“ — веднъж, при първото отваряне.
 *
 * Нарочно НЕ е при регистрацията: там всяка допълнителна стъпка изяжда
 * регистрации, а отговорът не е нужен, докато човекът няма нито един източник.
 * Тук вече е влязъл и въпросът е за негова полза, не за нашата статистика.
 *
 * Може да се пропусне. Пропуснат, дава неутралния набор материали — тоест
 * приложението работи еднакво добре, само бутоните са по-общи. Затова и
 * „Пропусни“ записва избор (празен низ), а не отлага въпроса за следващия път:
 * едно и също питане на всяко отваряне е по-лошо от общи бутони.
 */
export default function UseCasePrompt({ onDone }: { onDone: (value: string) => void }) {
  const [busy, setBusy] = useState('');

  async function choose(value: string) {
    setBusy(value || 'skip');
    try {
      await apiSend('/api/settings', 'PATCH', { useCase: value });
    } catch {
      // Провалът не бива да задържа човека на този екран: най-лошото е да го
      // питаме пак следващия път.
    }
    onDone(value);
  }

  return (
    <div class="usecase">
      <div class="usecase-head">
        <h2>За какво ще ползваш Записки?</h2>
        <p>
          По това нагласяме какви материали предлага студиото — резюме, задължения,
          обзор или въпроси. Може да се смени по всяко време от Настройки.
        </p>
      </div>

      <div class="usecase-grid">
        {USE_CASES.map((u) => (
          <button
            key={u.value}
            class="usecase-card"
            onClick={() => choose(u.value)}
            disabled={busy !== ''}
          >
            <span class="usecase-label">{u.label}</span>
            <span class="usecase-hint">{u.hint}</span>
          </button>
        ))}
      </div>

      <button class="usecase-skip" onClick={() => choose('')} disabled={busy !== ''}>
        {busy === 'skip' ? 'Момент…' : 'Пропусни — покажи ми общите материали'}
      </button>
    </div>
  );
}
