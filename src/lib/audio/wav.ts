/**
 * Gemini TTS връща сурово 16-битово PCM. Браузърите не го пускат директно,
 * затова слепваме сегментите и им слагаме WAV заглавка.
 */

export function concatPcm(segments: Uint8Array[]): Uint8Array {
  const total = segments.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const s of segments) {
    out.set(s, at);
    at += s.length;
  }
  return out;
}

export function pcmToWav(
  pcm: Uint8Array,
  { sampleRate = 24_000, channels = 1, bitsPerSample = 16 } = {},
): Uint8Array {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);

  writeAscii(wav, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true); // размер на файла - 8
  writeAscii(wav, 8, 'WAVE');

  writeAscii(wav, 12, 'fmt ');
  view.setUint32(16, 16, true); // размер на fmt блока
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeAscii(wav, 36, 'data');
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);

  return wav;
}

/** Продължителност в секунди на сурово PCM. */
export function pcmDuration(byteLength: number, sampleRate = 24_000, channels = 1): number {
  return Math.round(byteLength / (sampleRate * channels * 2));
}

/** „12:24“ */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
}
