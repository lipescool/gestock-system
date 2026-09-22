import { useState } from 'react';
import { useT, useMoney, useCurrency, useSetting } from '../store/settings';
import { useCart } from '../store/cart';
import { parseMoney } from '../i18n/currencies';
import { Icon } from '../lib/icons';
import './discount.css';

/**
 * Saisie d'une remise sur la vente, en pourcentage ou en montant.
 *
 * Les deux formes servent à des moments différents : « 10 % pour un bon
 * client » se pense en pourcentage, « j'enlève 500 pour faire un compte
 * rond » se pense en montant. Convertir de tête à chaque fois ralentit la
 * caisse, alors les deux sont proposées.
 *
 * La remise est toujours stockée en montant : c'est elle qui compte pour
 * le total et pour le ticket. Le pourcentage n'est qu'une façon de la
 * saisir.
 */
export default function DiscountField({ subtotal }: { subtotal: number }) {
  const t = useT();
  const money = useMoney();
  const cur = useCurrency()();
  const discountEnabled = useSetting('discountEnabled');
  const max = useSetting('maxDiscountPercent');
  const cart = useCart();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!discountEnabled) return null;

  const ceiling = Math.round((subtotal * max) / 100);

  const apply = () => {
    const value = raw.trim();
    if (value === '') { cancel(); return; }

    let amount: number;

    if (mode === 'percent') {
      const pct = Number(value.replace(',', '.'));
      if (!Number.isFinite(pct) || pct < 0) { setError(t('err.amount')); return; }
      if (pct > max) { setError(t('err.maxDiscount', { max })); return; }
      amount = Math.round((subtotal * pct) / 100);
    } else {
      const parsed = parseMoney(value, cur);
      if (parsed === null) { setError(t('err.amount')); return; }
      amount = parsed;
    }

    // Le plafond des réglages vaut pour les deux modes : sans cela, on le
    // contournerait en passant par le montant.
    if (amount > ceiling) { setError(t('err.maxDiscount', { max })); return; }
    if (amount > subtotal) { setError(t('err.discountTooBig')); return; }

    cart.setDiscount(amount);
    setError(null);
    setOpen(false);
  };

  const cancel = () => {
    cart.setDiscount(0);
    setRaw('');
    setError(null);
    setOpen(false);
  };

  // Remise posée : on l'affiche avec son équivalent en pourcentage, pour
  // que le caissier vérifie d'un coup d'œil qu'il n'a pas trop donné.
  if (cart.discount > 0 && !open) {
    const pct = subtotal > 0 ? Math.round((cart.discount / subtotal) * 100) : 0;
    return (
      <div className="disc applied">
        <Icon name="percent" size={15} />
        <span className="disc-label">
          {t('pay.discount')} <b>{pct}%</b>
        </span>
        <b className="disc-amount">− {money(cart.discount)}</b>
        <button className="disc-x" onClick={cancel} title={t('common.delete')}>×</button>
      </div>
    );
  }

  if (!open) {
    return (
      <button className="disc-add" onClick={() => setOpen(true)}>
        <Icon name="percent" size={14} />
        {t('pay.addDiscount')}
      </button>
    );
  }

  return (
    <div className="disc editing">
      <div className="disc-modes">
        <button className={mode === 'percent' ? 'on' : ''}
                onClick={() => { setMode('percent'); setError(null); }}>
          %
        </button>
        <button className={mode === 'amount' ? 'on' : ''}
                onClick={() => { setMode('amount'); setError(null); }}>
          {cur.symbol}
        </button>
      </div>

      <input
        autoFocus
        inputMode="decimal"
        value={raw}
        placeholder={mode === 'percent' ? `0 – ${max}` : money(ceiling)}
        className={error ? 'bad' : ''}
        onChange={(e) => { setRaw(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
          if (e.key === 'Escape') setOpen(false);
        }}
      />

      <button className="disc-ok" onClick={apply}>
        <Icon name="check" size={15} inherit />
      </button>
      <button className="disc-x" onClick={() => setOpen(false)}>×</button>

      {error && <em className="disc-err">{error}</em>}
    </div>
  );
}
