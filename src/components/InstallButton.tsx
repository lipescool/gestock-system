import { useEffect, useState } from 'react';
import { useSettings } from '../store/settings';
import { Icon } from '../lib/icons';

/**
 * Bouton d'installation de l'application.
 *
 * Chrome et Edge émettent `beforeinstallprompt` quand l'installation est
 * possible, et on rejoue l'événement au clic. Mais cet événement n'arrive
 * jamais en développement — il exige un service worker actif, donc un build
 * de production — et Safari ne l'émet dans aucun cas.
 *
 * Le bouton reste donc toujours visible et, faute d'invite automatique,
 * explique la marche à suivre pour le navigateur en cours. Un bouton qui
 * disparaît sans raison laisse le commerçant croire que la fonction n'existe
 * pas.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'ios' | 'safari' | 'chromium' | 'firefox';

function detect(): Platform {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/firefox/i.test(ua)) return 'firefox';
  if (/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return 'safari';
  return 'chromium';
}

export default function InstallButton() {
  const { t } = useSettings();
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);

  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Déjà installée : le bouton n'a plus de raison d'être.
  if (standalone || installed) return null;

  const platform = detect();

  const click = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setDeferred(null);
      return;
    }
    setHelp(true);
  };

  const steps: string[] = {
    ios: [t('install.ios1'), t('install.ios2'), t('install.ios3')],
    safari: [t('install.safari1'), t('install.safari2'), t('install.safari3')],
    chromium: [t('install.chrome1'), t('install.chrome2'), t('install.chrome3')],
    firefox: [t('install.firefox1'), t('install.firefox2')],
  }[platform];

  return (
    <>
      <button className="install-btn" onClick={() => void click()}>
        <Icon name="install" size={16} inherit />
        <span className="lbl">{t('common.install')}</span>
      </button>

      {help && (
        <div className="dlg-backdrop" onClick={() => setHelp(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <header className="dlg-head">
              <h2>{t('common.install')}</h2>
              <button className="dlg-x" onClick={() => setHelp(false)}>×</button>
            </header>

            <ol className="ios-steps">
              {steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>

            <p className="hint">{t('install.note')}</p>

            <button className="dlg-primary" onClick={() => setHelp(false)}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
