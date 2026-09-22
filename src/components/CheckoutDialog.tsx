import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, EMPTY } from '../db';
import { useSettings } from '../store/settings';
import { useCart } from '../store/cart';
import { printer } from '../print/service';
import { parseMoney } from '../i18n/currencies';
import type { Order } from '../db/schema';
import { Icon } from '../lib/icons';
import { PayIcon } from '../lib/payIcons';
import { playSound } from '../lib/sound';
import './dialog.css';

export default function CheckoutDialog(
  { total, methodId: initialMethodId, onClose }:
  { total: number; methodId: string | null; onClose: () => void },
) {
  const { t, money, settings, currencyInfo } = useSettings();
  const cart = useCart();

  const methods = useLiveQuery(
    () => db.paymentMethods.filter((m) => m.enabled).sortBy('position'), []) ?? EMPTY<never>();

  const [methodId, setMethodId] = useState<string | null>(initialMethodId);
  const [received, setReceived] = useState('');
  /* Tant que le commerçant n'a rien saisi, le champ suit le total : le
     cas courant est le compte exact, et un champ déjà juste évite une
     frappe par vente. Dès qu'il y touche, le montant lui appartient. */
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Voir Pos.tsx : dépendre du tableau complet relance l'effet à chaque
  // notification de la base, puisqu'il est recréé à chaque fois.
  const cur = currencyInfo();

  const firstMethodId = methods[0]?.id ?? null;
  useEffect(() => {
    if (!methodId && firstMethodId) setMethodId(firstMethodId);
  }, [firstMethodId, methodId]);

  /* Le total s'inscrit tout seul dans le champ. Il se remet à jour si le
     panier bouge encore — mais plus une fois que le commerçant a saisi
     son propre montant, sinon on effacerait ce qu'il vient de taper. */
  useEffect(() => {
    if (!touched) setReceived(String(total / 10 ** cur.decimals));
  }, [total, touched, cur.decimals]);

  // Une saisie invalide n'est pas silencieusement ramenée au total :
  // elle bloque l'encaissement et se signale à l'écran.
  const parsed = received.trim() === '' ? total : parseMoney(received, cur);
  const badAmount = parsed === null;
  const paid = parsed ?? 0;
  const change = Math.max(0, paid - total);
  const short = paid < total;

  /**
   * Montants que le client est susceptible de tendre.
   *
   * Une liste fixe ne sert à rien : pour un total de 13 000, proposer 500
   * ou 1 000 est absurde. On part du total et on remonte vers les coupures
   * rondes juste au-dessus — 15 000, 20 000, 25 000 — celles qui obligent
   * à rendre la monnaie.
   */
  const suggestions = (() => {
    const unit = 10 ** cur.decimals;
    const out = new Set<number>([total]);

    // Pas d'arrondi adapté à l'ordre de grandeur du total.
    const major = total / unit;
    const steps = major >= 50_000 ? [5_000, 10_000, 25_000, 50_000]
                : major >= 10_000 ? [1_000, 5_000, 10_000, 25_000]
                : major >= 1_000 ? [500, 1_000, 2_000, 5_000]
                : major >= 100 ? [100, 500, 1_000, 2_000]
                : [100, 500, 1_000];

    for (const step of steps) {
      const s = step * unit;
      // Le multiple de `step` immédiatement au-dessus du total. S'il tombe
      // pile dessus, on prend le suivant : rendre zéro n'aide personne.
      const up = Math.ceil((total + 1) / s) * s;
      out.add(up);
    }

    // Les grosses coupures rondes de la devise, quand elles dépassent le
    // total : le client paie souvent avec un seul billet.
    for (const note of [10_000, 20_000, 50_000]) {
      const n = note * unit;
      if (n > total) out.add(n);
    }

    // Quatre propositions, pas plus : elles remplissent exactement les
    // deux colonnes, et au-delà le commerçant lit une liste au lieu de
    // reconnaître un montant.
    return [...out].sort((a, b) => a - b).slice(0, 4);
  })();

  const confirm = async (thenPrint = false) => {
    setBusy(true);
    setError(null);
    try {
      const userId = (await db.settings.get('currentUserId'))?.value as string | null;
      const order = await cart.checkout({
        taxRate: settings.taxRate,
        paymentMethodId: methodId,
        paidAmount: paid,
        userId: userId ?? null,
      });
      setDone(order);
      playSound('sale');

      // L'impression reçoit la vente en argument : `done` n'est pas encore
      // à jour à cet instant, et attendre le rendu ferait perdre le geste.
      if (thenPrint) await doPrint(order);
    } catch (e) {
      playSound('error');
      const code = e instanceof Error ? e.message : 'ERROR';
      setError(code === 'OUT_OF_STOCK' ? t('err.outOfStock') : code);
    } finally {
      // Sans ce `finally`, l'indicateur restait actif après une vente
      // réussie et le bouton « Imprimer le ticket » demeurait grisé.
      setBusy(false);
    }
  };

  /**
   * Imprime un ticket. Si l'imprimante n'est pas encore appairée, la
   * connexion est établie au passage : en Bluetooth, le navigateur ouvre
   * alors son sélecteur d'appareil. C'est la seule façon de procéder, la
   * norme exige un geste de l'utilisateur à chaque nouvel appairage.
   */
  const doPrint = async (order: Order) => {
    setError(null);
    try {
      // On compare au transport réglé, et pas seulement à l'absence de
      // transport : sinon, changer d'imprimante en cours de session ne
      // prend effet qu'au rechargement de la page, et la vente sort sur
      // l'ancienne.
      if (printer.currentKind() !== settings.printTransport) {
        await printer.useBest(settings.printTransport, {
          address: settings.printerAddress,
          relay: (await db.settings.get('printRelay'))?.value as string ?? '',
        });
      }

      const method = methodId ? await db.paymentMethods.get(methodId) : null;
      await printer.printReceipt(order, {
        shopName: settings.shopName,
        address: (await db.settings.get('shopAddress'))?.value as string ?? '',
        phone: (await db.settings.get('shopPhone'))?.value as string ?? '',
        footer: settings.receiptFooter,
        currency: settings.currency,
        lang: settings.lang,
        width: settings.printWidth,
        cashierName: '',
        paymentMethod: method ?? null,
        labels: {
          subtotal: t('pay.subtotal'), taxes: settings.taxName || t('pay.taxes'), discount: t('pay.discount'),
          fee: t('pay.additionalFee'), total: t('pay.total'), method: t('pay.method'),
          received: t('pay.received'), change: t('pay.change'),
          items: t('pos.items'), cashier: t('set.users'),
        },
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : 'ERROR';
      // La vente est enregistrée quoi qu'il arrive : un échec d'impression
      // ne doit jamais la remettre en cause, on le signale simplement.
      setError(
        code === 'BLUETOOTH_UNSUPPORTED' ? t('print.unsupported')
        : code === 'NotFoundError' ? t('print.cancelled')
        // Une imprimante éteinte n'est pas une panne : le ticket part
        // en attente et sortira au rallumage. Le dire évite que le
        // commerçant croie l'avoir imprimé.
        : code === 'RELAY_PRINTER_OFFLINE' ? t('print.offlineSale')
        : code === 'RELAY_PRINTER_ERROR' ? t('print.errorSale')
        : t('print.failed'),
      );
    }
  };

  const printAgain = async () => {
    if (!done) return;
    setBusy(true);
    try { await doPrint(done); } finally { setBusy(false); }
  };

  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        {!done ? (
          <>
            <header className="dlg-head">
              <h2>{t('pos.confirm')}</h2>
              <button className="dlg-x" onClick={onClose}>×</button>
            </header>

            <div className="dlg-total">
              <small>{t('pay.total')}</small>
              <b>{money(total)}</b>
            </div>

            <div className="dlg-section">
              <h3>{t('pay.method')}</h3>
              <div className="pm-grid">
                {methods.map((m) => (
                  <button key={m.id} className={`pm ${methodId === m.id ? 'on' : ''}`}
                          onClick={() => setMethodId(m.id)}>
                    <PayIcon id={m.icon} size={22} />
                    <small>{m.name}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="dlg-section">
              <h3>{t('pay.received')}</h3>
              <input inputMode="decimal" value={received} placeholder={money(total)}
                     onFocus={(e) => e.currentTarget.select()}
                     onChange={(e) => { setTouched(true); setReceived(e.target.value); }} />
              <div className="quick">
                {suggestions.map((s) => (
                  <button key={s}
                          onClick={() => { setTouched(true);
                                           setReceived(String(s / 10 ** cur.decimals)); }}>
                    {money(s)}
                  </button>
                ))}
              </div>
              {!short && change > 0 && (
                <div className="change">
                  <span>{t('pay.change')}</span>
                  <b>{money(change)}</b>
                </div>
              )}
              {short && !badAmount && received !== '' && (
                <p className="dlg-err">{t('pay.missing')} {money(total - paid)}</p>
              )}
            </div>

            {error && <p className="dlg-err">{error}</p>}

            {badAmount && <p className="dlg-err">{t('err.amount')}</p>}

            {/* Encaisser et imprimer est le geste courant : il occupe le
                bouton principal. Encaisser seul reste possible, en retrait. */}
            <div className="pay-actions">
              <button className="pay-main" disabled={busy || !methodId || short || badAmount}
                      onClick={() => void confirm(true)}>
                <Icon name="print" size={17} inherit />
                <span>{t('pos.confirmPrint')}</span>
              </button>
              <button className="pay-alt" disabled={busy || !methodId || short || badAmount}
                      onClick={() => void confirm(false)}>
                {busy ? t('common.loading') : t('pos.confirmOnly')}
              </button>
            </div>

            <p className={`print-state ${printer.isConnected() ? 'ready' : ''}`}>
              {printer.isConnected()
                ? `${printer.deviceLabel() || t(`print.${settings.printTransport}`)}`
                : t('print.willConnect')}
            </p>
          </>
        ) : (
          <>
            <div className="dlg-success">
              <div className="tick"><Icon name="check" size={30} inherit strokeWidth={3} /></div>
              <h2>{done.ref}</h2>
              <p>{money(done.total)}</p>
              {done.changeAmount > 0 && (
                <div className="change big">
                  <span>{t('pay.change')}</span>
                  <b>{money(done.changeAmount)}</b>
                </div>
              )}
            </div>

            {error && <p className="dlg-err">{error}</p>}

            <div className="dlg-actions">
              <button className="dlg-ghost" disabled={busy} onClick={() => void printAgain()}>
                <Icon name="print" size={16} /> {t('print.receipt')}
              </button>
              <button className="dlg-primary" onClick={onClose}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
