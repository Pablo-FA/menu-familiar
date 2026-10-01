/**
 * Alarma de los temporizadores con Web Audio.
 *
 * - iOS solo deja sonar audio "desbloqueado" en un toque del usuario: unlockAudio() se
 *   llama al pulsar "Iniciar".
 * - Por defecto iOS silencia Web Audio con el interruptor de silencio: mientras suena la
 *   alarma se pide la sesión de audio "playback" (Safari 16.4+, navigator.audioSession) y
 *   al parar se devuelve a "auto", para no cortar la música más de lo necesario.
 * - Para que se oiga en el altavoz del iPhone: tonos en 1–2 kHz (donde el altavoz rinde
 *   más), onda cuadrada suavizada (más armónicos = más sonora) y un compresor que sube el
 *   volumen percibido sin saturar. El volumen final lo marcan los botones del iPhone.
 * - Se repite cada 1,6 s hasta que se atiende el aviso (stopAlarm) o pasa un minuto.
 */

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

const PATTERN_EVERY_MS = 1600;
const MAX_RING_MS = 60_000;

let ctx: AudioContext | null = null;
let output: AudioNode | null = null;
let ringTimer: number | null = null;
let ringStartedAt = 0;

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
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 6;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.1;
    const master = ctx.createGain();
    master.gain.value = 1;
    compressor.connect(master).connect(ctx.destination);
    output = compressor;
  } catch {
    ctx = null;
    output = null;
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

/** Onda cuadrada con los armónicos altos recortados: sonora pero no estridente. */
let squareWave: PeriodicWave | null = null;
function wave(audio: AudioContext): PeriodicWave {
  if (squareWave) return squareWave;
  const harmonics = 12;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n += 2) imag[n] = 1 / n;
  squareWave = audio.createPeriodicWave(real, imag);
  return squareWave;
}

/** Un patrón: cuatro pitidos rápidos alternando dos tonos ("di-du-di-du"). */
function playPattern(audio: AudioContext, destination: AudioNode) {
  const start = audio.currentTime + 0.03;
  const tones = [1760, 1318, 1760, 1318];
  tones.forEach((freq, i) => {
    const t = start + i * 0.16;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.setPeriodicWave(wave(audio));
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
    gain.gain.setValueAtTime(0.9, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(gain).connect(destination);
    osc.start(t);
    osc.stop(t + 0.14);
  });
}

/** Empieza a sonar (si no estaba sonando ya) hasta stopAlarm() o un minuto. */
export function startAlarm() {
  if (ringTimer !== null) return;
  const audio = context();
  if (!audio || !output) return;
  audioSession("playback");
  void audio.resume().catch(() => undefined);
  ringStartedAt = Date.now();
  const destination = output;
  const ring = () => {
    if (Date.now() - ringStartedAt > MAX_RING_MS) {
      stopAlarm();
      return;
    }
    playPattern(audio, destination);
  };
  ring();
  ringTimer = window.setInterval(ring, PATTERN_EVERY_MS);
}

export function stopAlarm() {
  if (ringTimer === null) return;
  window.clearInterval(ringTimer);
  ringTimer = null;
  // Margen para que termine el último pitido antes de soltar la sesión de audio.
  window.setTimeout(() => {
    if (ringTimer === null) audioSession("auto");
  }, 800);
}
