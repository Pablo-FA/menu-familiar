/**
 * Aviso sonoro de los temporizadores con Web Audio.
 *
 * iOS solo deja sonar audio que se haya "desbloqueado" en un toque del usuario, así que
 * unlockAudio() se llama al pulsar "Iniciar". Además, por defecto iOS silencia Web Audio
 * con el interruptor de silencio: justo antes de sonar se pide la sesión de audio
 * "playback" (Safari 16.4+, navigator.audioSession) y después se devuelve a "auto",
 * para no cortar la música que esté sonando más tiempo del necesario.
 */

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

let ctx: AudioContext | null = null;

function audioSession(type: "auto" | "playback") {
  const session = (navigator as AudioSessionNavigator).audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {
    // No soportado: se ignora.
  }
}

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function unlockAudio() {
  const audio = context();
  if (!audio) return;
  void audio.resume().catch(() => undefined);
  // Un búfer silencioso dentro del gesto termina de desbloquear el audio en iOS.
  const source = audio.createBufferSource();
  source.buffer = audio.createBuffer(1, 1, 22050);
  source.connect(audio.destination);
  source.start(0);
}

/** Tres pitidos cortos (~1 s en total). */
export function playAlarm() {
  const audio = context();
  if (!audio) return;
  audioSession("playback");
  void audio.resume().catch(() => undefined);
  const start = audio.currentTime + 0.05;
  for (let i = 0; i < 3; i++) {
    const t = start + i * 0.3;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }
  window.setTimeout(() => audioSession("auto"), 1200);
}
