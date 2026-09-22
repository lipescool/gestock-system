import { useEffect, useState } from 'react';
import { useSettings } from '../store/settings';
import { Icon } from '../lib/icons';
import {
  findUserByPin, lockRemaining, recordFailure, clearFailures,
  recoveryQuestion, recoverWithAnswer,
} from '../lib/pin';
import { playSound } from '../lib/sound';
import type { User } from '../db/schema';
import './lock.css';

/** Longueur du code, fixée à la configuration. */
const TAILLE = 5;

/**
 * Écran d'accès.
 *
 * Il s'affiche avant la caisse et à chaque reprise après une mise en
 * veille. Le pavé est à l'écran : sur une tablette de comptoir il n'y a
 * pas de clavier, et sur un ordinateur le clavier reste utilisable.
 */
export default function Lock({ onUnlock }: { onUnlock: (u: User | null) => void }) {
  const { t, settings } = useSettings();
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState(false);
  const [attente, setAttente] = useState(lockRemaining());

  /* Récupération : la question n'est proposée que si le commerçant en
     a défini une. Sans elle, afficher « code oublié » mènerait à une
     impasse. */
  const [question, setQuestion] = useState<string | null>(null);
  const [recup, setRecup] = useState(false);
  const [reponse, setReponse] = useState('');
  const [reponseFausse, setReponseFausse] = useState(false);

  useEffect(() => { void recoveryQuestion().then(setQuestion); }, []);

  /* Le compte à rebours se rafraîchit chaque seconde tant qu'il court :
     un écran figé sur « patientez » sans voir le temps défiler donne
     l'impression d'un blocage définitif. */
  useEffect(() => {
    if (attente <= 0) return;
    const id = setInterval(() => setAttente(lockRemaining()), 500);
    return () => clearInterval(id);
  }, [attente]);

  const valider = async (saisi: string) => {
    const user = await findUserByPin(saisi);
    if (user) {
      clearFailures();
      playSound('sale');
      onUnlock(user);
      return;
    }

    playSound('error');
    setErreur(true);
    const bloque = recordFailure();
    if (bloque > 0) setAttente(bloque);
    // Le code s'efface après l'animation : l'effacer aussitôt donne
    // l'impression que la touche n'a pas répondu.
    setTimeout(() => { setCode(''); setErreur(false); }, 600);
  };

  const taper = (chiffre: string) => {
    if (attente > 0 || erreur || code.length >= TAILLE) return;
    const suite = code + chiffre;
    setCode(suite);
    playSound('tap');
    if (suite.length === TAILLE) void valider(suite);
  };

  const effacer = () => {
    if (attente > 0 || erreur) return;
    setCode((c) => c.slice(0, -1));
  };

  /* Le clavier physique répond comme le pavé : sur un ordinateur,
     composer à la souris serait pénible. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) taper(e.key);
      else if (e.key === 'Backspace') effacer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const repondre = async () => {
    if (!reponse.trim()) return;
    if (await recoverWithAnswer(reponse)) {
      /* Le code est effacé : la caisse s'ouvre, et le commerçant en
         choisira un nouveau dans les réglages. */
      playSound('sale');
      onUnlock(null);
      return;
    }
    playSound('error');
    setReponseFausse(true);
    setTimeout(() => setReponseFausse(false), 2000);
  };

  const secondes = Math.ceil(attente / 1000);

  if (recup) {
    return (
      <div className="lock">
        <div className="lock-box">
          <div className="lock-logo"><Icon name="lock" size={26} /></div>
          <h1>{settings.shopName}</h1>

          {/* Aucune question définie : il n'y a pas d'issue depuis cet
              écran. On le dit clairement plutôt que de laisser
              chercher. */}
          {!question ? (
            <>
              <p className="lock-hint">{t('lock.noRecovery')}</p>
              <p className="lock-question">{t('lock.noRecoveryHelp')}</p>
              <button className="lock-link" onClick={() => setRecup(false)}>
                {t('common.back')}
              </button>
            </>
          ) : (
          <>
          <p className="lock-hint">{t('lock.answerToReset')}</p>

          <p className="lock-question">{question}</p>

          <input className={`lock-answer ${reponseFausse ? 'bad' : ''}`}
                 value={reponse} autoFocus
                 onChange={(e) => setReponse(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') void repondre(); }}
                 placeholder={t('lock.yourAnswer')} />

          {reponseFausse && <p className="lock-err">{t('lock.wrongAnswer')}</p>}

          <button className="lock-main" onClick={() => void repondre()}
                  disabled={!reponse.trim()}>
            {t('lock.unlock')}
          </button>
          <button className="lock-link" onClick={() => { setRecup(false); setReponse(''); }}>
            {t('common.back')}
          </button>
          </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="lock">
      <div className="lock-box">
        <div className="lock-logo"><Icon name="lock" size={26} /></div>
        <h1>{settings.shopName}</h1>
        <p className="lock-hint">
          {attente > 0 ? t('lock.wait').replace('{s}', String(secondes)) : t('lock.enterPin')}
        </p>

        <div className={`lock-dots ${erreur ? 'bad' : ''}`}>
          {Array.from({ length: TAILLE }, (_, i) => (
            <span key={i} className={i < code.length ? 'on' : ''} />
          ))}
        </div>

        <div className="lock-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <button key={n} onClick={() => taper(n)} disabled={attente > 0}>{n}</button>
          ))}
          <span />
          <button onClick={() => taper('0')} disabled={attente > 0}>0</button>
          <button className="lock-del" onClick={effacer} disabled={attente > 0}
                  aria-label={t('common.delete')}>
            <Icon name="backspace" size={21} inherit />
          </button>
        </div>

        {/* Toujours proposé : sans question de secours le lien ne
            déverrouille rien, mais il dit au moins pourquoi et quoi
            faire. Laisser l'écran muet devant quelqu'un de bloqué
            serait pire. */}
        <button className="lock-link" onClick={() => setRecup(true)}>
          {t('lock.forgot')}
        </button>
      </div>
    </div>
  );
}
