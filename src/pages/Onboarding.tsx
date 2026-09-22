import { useEffect, useState } from 'react';
import { db, uid, now } from '../db';
import { logAudit } from '../db/audit';
import { useSettings } from '../store/settings';
import { CURRENCIES } from '../i18n/currencies';
import { LANGS } from '../i18n/seed';
import { printer } from '../print/service';
import { Icon } from '../lib/icons';
import { hashPin, hashAnswer } from '../lib/pin';
import { SKINS, applyTheme, type SkinId, type ThemeMode } from '../lib/theme';
import type { PaymentMethod } from '../db/schema';
import { PayIcon, PAY_ICONS } from '../lib/payIcons';
import './onboarding.css';

/** Propositions en un clic. Le commerçant reste libre de saisir les siennes. */
const SUGGESTIONS = [
  { name: 'Orange Money', icon: 'mobile' },
  { name: 'MTN MoMo', icon: 'mobile' },
  { name: 'Moov Money', icon: 'mobile' },
  { name: 'Wave', icon: 'wallet' },
  { name: 'Carte bancaire', icon: 'card' },
  { name: 'Virement', icon: 'bank' },
  { name: 'Crédit client', icon: 'credit' },
  { name: 'Chèque', icon: 'cheque' },
];

/**
 * Première configuration. Elle s'affiche tant que le commerçant n'a pas
 * terminé : la caisse ne sert à rien sans devise ni compte. Tout ce qui est
 * choisi ici reste modifiable ensuite dans Paramètres.
 */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { t, setLang, set, settings } = useSettings();
  const [step, setStep] = useState(0);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  const [shop, setShop] = useState({ name: '', address: '', phone: '' });
  const [money, setMoney] = useState({ currency: 'XOF', taxRate: 0 });
  /* Apparence : choisie dès la configuration, pour que le commerçant
     reconnaisse son application dès la première ouverture. */
  const [look, setLook] = useState<{ skin: SkinId; mode: ThemeMode }>({
    skin: 'emeraude', mode: 'auto',
  });

  const [owner, setOwner] = useState({
    name: '', pin: '', pin2: '',
    // Question de secours : un code oublié enfermerait sinon le
    // commerçant hors de sa propre caisse, sans aucun recours.
    question: '', reponse: '',
  });
  const [print, setPrint] = useState<{ transport: 'bluetooth' | 'network' | 'browser'; width: 58 | 80 }>(
    { transport: printer.bluetoothSupported() ? 'bluetooth' : 'browser', width: 58 },
  );

  const [newName, setNewName] = useState('');
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [newIcon, setNewIcon] = useState('cash');

  useEffect(() => {
    void db.paymentMethods.orderBy('position').toArray().then(setMethods);
  }, []);

  const toggleMethod = (id: string) =>
    setMethods((ms) => ms.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)));

  const renameMethod = (id: string, name: string) =>
    setMethods((ms) => ms.map((m) => (m.id === id ? { ...m, name } : m)));

  const setMethodIcon = (id: string, icon: string) =>
    setMethods((ms) => ms.map((m) => (m.id === id ? { ...m, icon } : m)));

  const dropMethod = (id: string) =>
    setMethods((ms) => ms.filter((m) => m.id !== id));

  const addMethod = (name?: string, icon?: string) => {
    const label = (name ?? newName).trim();
    if (!label) return;
    setMethods((ms) => [...ms, {
      id: uid(),
      name: label,
      icon: icon ?? newIcon,
      opensDrawer: false,
      requiresRef: false,
      enabled: true,
      position: ms.length,
      updatedAt: now(),
    }]);
    if (!name) { setNewName(''); setNewIcon('cash'); }
  };

  const canNext = (): boolean => {
    switch (step) {
      case 1: return shop.name.trim().length > 1;
      case 3: return owner.name.trim().length > 1
        && owner.pin.length === 5 && owner.pin === owner.pin2
        && owner.question.trim().length > 0 && owner.reponse.trim().length > 0;
      case 4: return methods.some((m) => m.enabled);
      default: return true;
    }
  };

  const finish = async () => {
    const userId = uid();
    await db.users.add({
      id: userId,
      name: owner.name.trim(),
      role: 'owner',
      pinHash: await hashPin(owner.pin),
      recoveryQuestion: owner.question.trim(),
      recoveryHash: await hashAnswer(owner.reponse),
      avatar: null,
      active: true,
      updatedAt: now(),
    });

    // La liste affichée fait foi : ce que le commerçant a retiré à l'écran
    // doit disparaître de la base, pas seulement être désactivé.
    await db.paymentMethods.clear();
    await db.paymentMethods.bulkAdd(
      methods
        .filter((m) => m.name.trim().length > 0)
        .map((m, i) => ({ ...m, name: m.name.trim(), position: i, updatedAt: now() })),
    );

    await set('shopName', shop.name.trim());
    await set('currency', money.currency);
    await set('taxRate', money.taxRate);
    await set('printTransport', print.transport);
    await set('printWidth', print.width);
    await set('skin', look.skin);
    await set('themeMode', look.mode);
    await db.settings.bulkPut([
      { key: 'shopAddress', value: shop.address.trim() },
      { key: 'shopPhone', value: shop.phone.trim() },
      { key: 'currentUserId', value: userId },
      { key: 'onboarded', value: true },
    ]);

    await logAudit({ entity: 'system', entityId: 'setup', action: 'onboarding', userId });
    onDone();
  };

  const steps = [
    /* 0 — Langue */
    <section key="lang" className="ob-step">
      <h2>Gestock</h2>
      <p className="ob-sub">{t('ob.pickLang')} / Choose your language</p>
      <div className="ob-langs">
        {LANGS.map((l) => (
          <button
            key={l.code}
            className={`ob-lang ${settings.lang === l.code ? 'on' : ''}`}
            onClick={() => void setLang(l.code)}
          >
            <span className="flag">{l.flag}</span>
            <span>{l.label}</span>
          </button>
        ))}
      </div>
    </section>,

    /* 1 — Boutique */
    <section key="shop" className="ob-step">
      <h2>{t('set.shopName')}</h2>
      <p className="ob-sub">{t('ob.shopHint')}</p>
      <label className="ob-field">
        <span>{t('set.shopName')} *</span>
        <input value={shop.name} onChange={(e) => setShop({ ...shop, name: e.target.value })}
               placeholder={t('ob.shopPlaceholder')} autoFocus />
      </label>
      <label className="ob-field">
        <span>{t('ob.address')}</span>
        <input value={shop.address} onChange={(e) => setShop({ ...shop, address: e.target.value })}
               placeholder="Cocody, Abidjan" />
      </label>
      <label className="ob-field">
        <span>{t('ob.phone')}</span>
        <input value={shop.phone} onChange={(e) => setShop({ ...shop, phone: e.target.value })}
               placeholder="+225 00 00 00 00" inputMode="tel" />
      </label>
    </section>,

    /* 2 — Devise */
    <section key="currency" className="ob-step">
      <h2>{t('set.currency')}</h2>
      <p className="ob-sub">{t('ob.currencyHint')}</p>
      <div className="ob-currencies">
        {CURRENCIES.map((c) => (
          <button
            key={c.code}
            className={`ob-cur ${money.currency === c.code ? 'on' : ''}`}
            onClick={() => setMoney({ ...money, currency: c.code })}
          >
            <b>{c.symbol}</b>
            <span>{c.code}</span>
            <small>{c.name}</small>
          </button>
        ))}
      </div>
      <label className="ob-field">
        <span>{t('set.taxRate')} (%)</span>
        <input type="number" min={0} max={100} step={0.5} value={money.taxRate}
               onChange={(e) => setMoney({ ...money, taxRate: Number(e.target.value) || 0 })} />
      </label>
    </section>,

    /* 3 — Apparence */
    <section key="look" className="ob-step">
      <h2>{t('set.appearance')}</h2>
      <p className="ob-sub">{t('ob.appearanceHint')}</p>

      <div className="ob-skins">
        {SKINS.map((s) => (
          <button key={s.id}
                  className={`ob-skin ${look.skin === s.id ? 'on' : ''}`}
                  onClick={() => {
                    setLook({ ...look, skin: s.id });
                    // L'apparence change sous les yeux : choisir une
                    // couleur sans la voir n'aurait pas de sens.
                    applyTheme(s.id, look.mode, 'normal');
                  }}>
            <span className="ob-skin-dot" style={{ background: s.couleur }} />
            <b>{t(`skin.${s.id}`)}</b>
          </button>
        ))}
      </div>

      <div className="ob-modes">
        {(['auto', 'light', 'dark'] as const).map((m) => (
          <button key={m} className={look.mode === m ? 'on' : ''}
                  onClick={() => {
                    setLook({ ...look, mode: m });
                    applyTheme(look.skin, m, 'normal');
                  }}>
            {t(`theme.${m}`)}
          </button>
        ))}
      </div>
    </section>,

    /* 4 — Compte */
    <section key="owner" className="ob-step">
      <h2>{t('ob.account')}</h2>
      <p className="ob-sub">{t('ob.accountHint')}</p>
      <label className="ob-field">
        <span>{t('ob.yourName')} *</span>
        <input value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })}
               placeholder={t('ob.ownerPlaceholder')} />
      </label>
      <div className="ob-row">
        <label className="ob-field">
          <span>{t('ob.pin')} *</span>
          <input type="password" inputMode="numeric" value={owner.pin} maxLength={5}
                 onChange={(e) => setOwner({ ...owner, pin: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
        </label>
        <label className="ob-field">
          <span>{t('ob.pinConfirm')} *</span>
          <input type="password" inputMode="numeric" value={owner.pin2} maxLength={5}
                 onChange={(e) => setOwner({ ...owner, pin2: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
        </label>
      </div>
      {owner.pin2.length > 0 && owner.pin !== owner.pin2 && (
        <p className="ob-err">{t('ob.pinMismatch')}</p>
      )}

      {/* Sans serveur ni adresse électronique, cette question est le
          seul moyen de retrouver l'accès après un oubli. */}
      <p className="ob-note">{t('ob.recoveryWhy')}</p>

      <label className="ob-field">
        <span>{t('sec.question')} *</span>
        <input value={owner.question} maxLength={80}
               placeholder={t('sec.questionPlaceholder')}
               onChange={(e) => setOwner({ ...owner, question: e.target.value })} />
      </label>
      <label className="ob-field">
        <span>{t('sec.answer')} *</span>
        <input value={owner.reponse} maxLength={60}
               onChange={(e) => setOwner({ ...owner, reponse: e.target.value })} />
      </label>
    </section>,

    /* 5 — Moyens de paiement */
    <section key="pay" className="ob-step">
      <h2>{t('set.payments')}</h2>
      <p className="ob-sub">{t('ob.payHint')}</p>

      <div className="ob-methods">
        {methods.map((m) => (
          <div key={m.id} className={`ob-method ${m.enabled ? 'on' : ''}`}>
            <button className="ico-btn" title={t('ob.changeIcon')}
                    onClick={() => setPickFor(pickFor === m.id ? null : m.id)}>
              <PayIcon id={m.icon} size={19} />
            </button>
            <input
              className="name-in"
              value={m.name}
              onChange={(e) => renameMethod(m.id, e.target.value)}
            />
            <button className="check-btn" onClick={() => toggleMethod(m.id)}
                    title={t(m.enabled ? 'common.off' : 'common.on')}>
              {m.enabled ? '✓' : '○'}
            </button>
            {methods.length > 1 && (
              <button className="del-btn" onClick={() => dropMethod(m.id)} title={t('common.remove')}>
                <Icon name="trash" size={15} />
              </button>
            )}

            {pickFor === m.id && (
              <div className="ob-picker">
                {PAY_ICONS.map((ic) => (
                  <button key={ic} className={`icon-opt ${m.icon === ic ? 'on' : ''}`}
                          onClick={() => { setMethodIcon(m.id, ic); setPickFor(null); }}>
                    <PayIcon id={ic} size={18} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ob-add">
        <button className="ico-btn" title={t('ob.changeIcon')}
                onClick={() => setPickFor(pickFor === 'new' ? null : 'new')}>
          <PayIcon id={newIcon} size={19} />
        </button>
        <input
          value={newName}
          placeholder={t('ob.methodPlaceholder')}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addMethod()}
        />
        <button className="ob-add-btn" disabled={!newName.trim()} onClick={() => addMethod()}>
          + {t('common.add')}
        </button>
      </div>

      {pickFor === 'new' && (
        <div className="ob-picker standalone">
          {PAY_ICONS.map((ic) => (
            <button key={ic} className={`icon-opt ${newIcon === ic ? 'on' : ''}`}
                    onClick={() => { setNewIcon(ic); setPickFor(null); }}>
              <PayIcon id={ic} size={18} />
            </button>
          ))}
        </div>
      )}

      <div className="ob-suggest">
        {SUGGESTIONS
          .filter((s) => !methods.some((m) => m.name.toLowerCase() === s.name.toLowerCase()))
          .map((s) => (
            <button key={s.name} onClick={() => addMethod(s.name, s.icon)}>
              <PayIcon id={s.icon} size={15} /> {s.name}
            </button>
          ))}
      </div>
    </section>,

    /* 6 — Impression */
    <section key="print" className="ob-step">
      <h2>{t('set.printing')}</h2>
      <p className="ob-sub">{t('ob.printHint')}</p>

      <div className="ob-field">
        <span>{t('print.transport')}</span>
        <div className="ob-choices">
          {(['bluetooth', 'network', 'browser'] as const).map((k) => {
            const disabled = k === 'bluetooth' && !printer.bluetoothSupported();
            return (
              <button key={k} disabled={disabled}
                      className={`ob-choice ${print.transport === k ? 'on' : ''}`}
                      onClick={() => setPrint({ ...print, transport: k })}>
                {t(`print.${k}`)}
              </button>
            );
          })}
        </div>
        {!printer.bluetoothSupported() && (
          <p className="ob-note">{t('print.unsupported')}</p>
        )}
      </div>

      <div className="ob-field">
        <span>{t('print.paperWidth')}</span>
        <div className="ob-choices">
          {([58, 80] as const).map((w) => (
            <button key={w} className={`ob-choice ${print.width === w ? 'on' : ''}`}
                    onClick={() => setPrint({ ...print, width: w })}>
              {w} mm
            </button>
          ))}
        </div>
      </div>
    </section>,
  ];

  const last = step === steps.length - 1;

  return (
    <div className="ob">
      <div className="ob-card">
        <div className="ob-progress">
          {steps.map((_, i) => (
            <span key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>

        {steps[step]}

        <div className="ob-actions">
          {step > 0 && (
            <button className="ob-back" onClick={() => setStep(step - 1)}>
              {t('ob.back')}
            </button>
          )}
          <button
            className="ob-next"
            disabled={!canNext()}
            onClick={() => (last ? void finish() : setStep(step + 1))}
          >
            {last ? t('ob.finish') : t('ob.next')}
          </button>
        </div>
      </div>
    </div>
  );
}


