import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { db } from './db';
import { seedIfEmpty } from './db/seed';
import { pinRequired } from './lib/pin';
import { installationValide, controlerAupresDuServeur, oublierLicence } from './lib/license';
import Activate from './pages/Activate';
import { useLock } from './store/lock';
import Lock from './pages/Lock';
import { useSettings } from './store/settings';
import { startAutoBackupWatcher } from './lib/backup';
import { primeAudio, createAudioEarly } from './lib/sound';
import { exposeDevTools } from './db/demo';
import Shell from './components/Shell';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Pos from './pages/Pos';
import Stock from './pages/Stock';
import Expenses from './pages/Expenses';
import History from './pages/History';
import Settings from './pages/Settings';

export default function App() {
  const load = useSettings((s) => s.load);
  const ready = useSettings((s) => s.ready);
  const lang = useSettings((s) => s.settings.lang);
  const shopName = useSettings((s) => s.settings.shopName);

  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  /* Caisse verrouillée tant que le code n'est pas composé. L'état part
     de `null` : on ne sait pas encore s'il y a un code à demander, et
     afficher l'écran d'accès avant de le savoir le ferait clignoter
     sur les installations qui n'en ont pas. */
  const verrouille = useLock((s) => s.locked);
  const setVerrouille = useLock((s) => s.setLocked);

  /* Licence : `null` tant qu'on ne l'a pas vérifiée. L'écran
     d'activation passe avant tout le reste — il n'y a rien à
     configurer tant que le droit d'usage n'est pas établi. */
  const [activee, setActivee] = useState<boolean | null>(null);

  /* Le serveur a désavoué cette licence : elle sert ailleurs, ou vous
     l'avez coupée. */
  const [licenceKo, setLicenceKo] = useState<'prise' | 'revoquee' | null>(null);

  useEffect(() => {
    void (async () => {
      await seedIfEmpty();
      // L'indicateur est lu avant `load()` : appelés l'un après l'autre,
      // chacun déclenchait son propre rendu et l'application s'affichait
      // en deux temps, ce qui donnait un clignotement au démarrage.
      const flag = await db.settings.get('onboarded');
      await load();
      exposeDevTools();
      setOnboarded(flag?.value === true);
      setVerrouille(await pinRequired());
      setActivee(await installationValide());

      /* Contrôle auprès du serveur, sans bloquer le démarrage : la
         caisse s'ouvre tout de suite, la réponse arrive quand elle
         arrive. Sans réseau, il ne se passe rien. */
      void controlerAupresDuServeur(
        useSettings.getState().settings.shopName,
      ).then((etat) => {
        if (etat === 'prise' || etat === 'revoquee') {
          /* La clé est retirée du poste : sans cela, elle resterait
             enregistrée et l'écran reviendrait à chaque démarrage
             sans que le commerçant puisse en saisir une autre. */
          oublierLicence();
          setLicenceKo(etat);
        }
      });
    })();
  }, [load]);

  // Surveillance de l'heure de sauvegarde, tant que l'application est ouverte.
  useEffect(() => {
    if (!ready || !onboarded) return;
    return startAutoBackupWatcher(() => ({
      enabled: useSettings.getState().settings.autoBackupEnabled,
      time: useSettings.getState().settings.autoBackupTime,
      shopName: useSettings.getState().settings.shopName,
    }));
  }, [ready, onboarded]);

  // Le moteur audio se réveille au tout premier geste, quel qu'il soit :
  // sans cela, le premier son de la session sort au ralenti.
  useEffect(() => {
    // Le contexte est construit dès l'ouverture de la page ; le premier
    // geste ne fait plus que le réveiller.
    createAudioEarly();

    const wake = () => {
      void primeAudio();
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = shopName || 'Gestock';
  }, [lang, shopName]);

  if (!ready || onboarded === null || verrouille === null || activee === null) {
    return <div className="boot" />;
  }

  if (!activee) {
    return <Activate onDone={() => setActivee(true)} />;
  }

  /* Licence désavouée : on redemande une clé, en disant pourquoi.
     Le commerçant honnête a la sienne sous la main ; celui qui a
     copié celle d'un autre s'arrête ici. */
  if (licenceKo) {
    return (
      <Activate
        motif={licenceKo}
        onDone={() => { setLicenceKo(null); setActivee(true); }}
      />
    );
  }

  if (!onboarded) {
    return (
      <Onboarding onDone={() => {
        void load();
        setOnboarded(true);
        /* Le commerçant vient de saisir son code : lui redemander
           aussitôt n'aurait pas de sens. */
        setVerrouille(false);
      }} />
    );
  }

  if (verrouille) {
    return (
      <Lock onUnlock={(u) => {
        // L'utilisateur reconnu devient celui qui encaisse : c'est son
        // nom qui figurera sur les tickets et dans le journal. Après
        // une récupération, personne n'est identifié : on garde alors
        // le dernier connu.
        if (u) void db.settings.put({ key: 'currentUserId', value: u.id });
        setVerrouille(false);
      }} />
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/pos" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pos" element={<Pos />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/pos" replace />} />
      </Routes>
    </Shell>
  );
}
