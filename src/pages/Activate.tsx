import { useState } from 'react';
import { useSettings } from '../store/settings';
import { Icon } from '../lib/icons';
import { licenceValide, enregistrerLicence } from '../lib/license';
import './activate.css';

/**
 * Saisie de la clé de licence.
 *
 * Premier écran d'une installation neuve, avant même la
 * configuration : il n'y a rien à régler tant que le droit d'usage
 * n'est pas établi.
 */
export default function Activate(
  { onDone, motif }: { onDone: () => void; motif?: 'prise' | 'revoquee' },
) {
  const { t } = useSettings();
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const valider = async () => {
    if (occupe) return;
    setOccupe(true);
    setErreur(false);

    if (await licenceValide(saisie)) {
      await enregistrerLicence(saisie);
      onDone();
      return;
    }

    setOccupe(false);
    setErreur(true);
  };

  return (
    <div className="lic-screen">
      <div className="lic-box">
        <div className="lic-logo"><Icon name="lock" size={28} /></div>
        <h1>{t(motif ? 'lic.blockedTitle' : 'lic.title')}</h1>
        {/* Le motif explique pourquoi la clé est redemandée : sans
            cela, un commerçant croirait à une panne. */}
        <p className="lic-sub">
          {motif ? t(motif === 'prise' ? 'lic.alreadyUsed' : 'lic.revoked')
                 : t('lic.subtitle')}
        </p>

        <div className={`lic-field ${erreur ? 'bad' : ''}`}>
          <span className="lic-prefix">GS</span>
          <input
          className="lic-key"

          value={saisie}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          /* Le champ ne contient que les vingt signes utiles,
             groupés par cinq — sans le préfixe. Le garder dans la
             valeur le faisait relire comme une donnée à chaque
             frappe, et il s'accumulait : « GS-GSGSG-SGSGS… ». */
          onChange={(e) => {
            let signes = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');

            /* Le préfixe est déjà affiché à gauche du champ, mais le
               commerçant recopie sa clé en entier — « GS » compris.
               On le retire s'il a été saisi, sinon les deux premiers
               signes de la clé seraient perdus et elle serait
               refusée sans qu'on comprenne pourquoi. */
            if (signes.startsWith('GS') && signes.length > 20) {
              signes = signes.slice(2);
            }

            setSaisie((signes.slice(0, 20).match(/.{1,5}/g) ?? []).join('-'));
            setErreur(false);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') void valider(); }}
          />
        </div>

        {erreur && <p className="lic-err">{t('lic.invalid')}</p>}

        <button className="lic-main" onClick={() => void valider()}
                disabled={occupe || saisie.replace(/-/g, '').length !== 20}>
          {occupe ? t('common.loading') : t('lic.activate')}
        </button>

        <p className="lic-help">{t('lic.help')}</p>
      </div>
    </div>
  );
}
