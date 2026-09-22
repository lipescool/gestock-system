/**
 * Retours sonores de la caisse.
 *
 * Les sons sont synthétisés à la volée par l'API Web Audio plutôt que chargés
 * depuis des fichiers : rien à télécharger, rien à mettre en cache, et
 * l'application reste entièrement hors ligne.
 *
 * Un caissier ne regarde pas toujours l'écran quand il scanne. Le son lui
 * confirme que l'article est passé sans qu'il ait à lever les yeux.
 */

type Tone = { freq: number; start: number; dur: number; gain?: number };

let ctx: AudioContext | null = null;

/** Le contexte audio ne peut naître que d'un geste de l'utilisateur. */
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as {
      webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ac = ctx;
    // Le navigateur suspend le contexte après une période d'inactivité.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Prépare le moteur audio au premier geste de l'utilisateur.
 *
 * Un contexte audio naît suspendu : le navigateur exige une interaction
 * avant de le laisser produire du son, et sa reprise prend quelques
 * dizaines de millisecondes. Sans attendre cette reprise, le premier
 * son partait sur un contexte encore endormi et sortait étiré, voire
 * pas du tout — c'est pourquoi il fallait cliquer deux fois.
 *
 * On attend donc la reprise avant de jouer le silence de rodage, et on
 * retient la promesse : un son demandé entre-temps patientera dessus
 * plutôt que de partir dans le vide.
 */
let priming: Promise<void> | null = null;

export function primeAudio(): Promise<void> {
  if (priming) return priming;

  const ac = audio();
  if (!ac) return Promise.resolve();

  priming = (async () => {
    try {
      if (ac.state === 'suspended') await ac.resume();
    } catch {
      // Un navigateur qui refuse l'audio ne doit jamais bloquer la caisse.
    }
  })();

  return priming;
}

/**
 * Crée le contexte audio au chargement de la page.
 *
 * Il naît suspendu — le navigateur l'exige — mais le seul fait de
 * l'avoir construit à l'avance évite que sa création, son réveil et la
 * première note se bousculent au même instant. C'est ce qui rendait le
 * premier son de la session traînant ou muet.
 */
export function createAudioEarly(): void {
  audio();
}

function play(tones: Tone[], type: OscillatorType = 'sine'): void {
  const ac = audio();
  if (!ac) return;

  // Le contexte n'est pas encore réveillé : on rejoue la demande une
  // fois prêt, au lieu de la perdre. C'est le cas du tout premier clic,
  // quand le rodage n'a pas eu le temps d'aboutir.
  if (ac.state !== 'running') {
    void primeAudio().then(() => {
      if (ac.state === 'running') emit(ac, tones, type);
    });
    return;
  }

  emit(ac, tones, type);
}

function emit(ac: AudioContext, tones: Tone[], type: OscillatorType): void {
  const now = ac.currentTime;
  for (const t of tones) {
    const osc = ac.createOscillator();
    const vol = ac.createGain();

    osc.type = type;
    osc.frequency.value = t.freq;

    // Attaque et extinction douces : un créneau net produit un claquement
    // désagréable sur les petits haut-parleurs.
    const peak = t.gain ?? 0.12;
    const t0 = now + t.start;
    vol.gain.setValueAtTime(0.0001, t0);
    vol.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + t.dur);

    osc.connect(vol).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + t.dur + 0.02);
  }
}

export type SoundName = 'tap' | 'add' | 'remove' | 'sale' | 'error' | 'scan';

const SOUNDS: Record<SoundName, () => void> = {
  // Clic sec et court, pour une pression de bouton.
  tap: () => play([{ freq: 900, start: 0, dur: 0.05, gain: 0.07 }], 'triangle'),

  // Ajout au panier : deux notes qui montent.
  add: () => play([
    { freq: 760, start: 0, dur: 0.07 },
    { freq: 1140, start: 0.055, dur: 0.09 },
  ], 'triangle'),

  // Retrait : la même figure, à l'envers.
  remove: () => play([
    { freq: 640, start: 0, dur: 0.07, gain: 0.09 },
    { freq: 420, start: 0.055, dur: 0.09, gain: 0.09 },
  ], 'triangle'),

  // Vente encaissée : un petit arpège qui s'entend dans le bruit d'une boutique.
  sale: () => play([
    { freq: 784, start: 0, dur: 0.11, gain: 0.13 },
    { freq: 1047, start: 0.09, dur: 0.11, gain: 0.13 },
    { freq: 1319, start: 0.18, dur: 0.22, gain: 0.14 },
  ], 'sine'),

  // Erreur : deux notes basses, sans agressivité.
  error: () => play([
    { freq: 300, start: 0, dur: 0.12, gain: 0.11 },
    { freq: 220, start: 0.13, dur: 0.18, gain: 0.11 },
  ], 'square'),

  // Douchette : un bip unique, proche de celui des caisses de supermarché.
  scan: () => play([{ freq: 2100, start: 0, dur: 0.08, gain: 0.09 }], 'square'),
};

let enabled = true;

/** Branché sur le réglage « Sons » des paramètres. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function soundEnabled(): boolean {
  return enabled;
}

export function playSound(name: SoundName): void {
  if (!enabled) return;
  try {
    SOUNDS[name]();
  } catch {
    // Un navigateur qui refuse l'audio ne doit jamais bloquer une vente.
  }
}
