import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, EMPTY } from '../db';
import { useSettings, useT, useMoney, useLang, useSetting } from '../store/settings';
import { useCart } from '../store/cart';
import { listenScanner } from '../lib/barcode';
import { CategoryIconSvg } from '../lib/categoryIcons';
import { Icon } from '../lib/icons';
import { playSound } from '../lib/sound';
import { summarize } from '../lib/reports';
import { useCachedQuery } from '../lib/useCachedQuery';
import PeriodFilter, { initialPeriod, type PeriodValue } from '../components/PeriodFilter';
import CheckoutDialog from '../components/CheckoutDialog';
import DiscountField from '../components/DiscountField';
import type { Product } from '../db/schema';
import './pos.css';
import { withUnit } from '../lib/units';

export default function Pos() {
  // Sélecteurs ciblés plutôt que le store entier : sans eux, la caisse se
  // redessinait au moindre changement d'un réglage sans rapport, ce qui
  // faisait vaciller les chiffres et les moyens de paiement.
  const t = useT();
  const money = useMoney();
  const taxRate = useSetting('taxRate');
  const taxName = useSetting('taxName');
  const showImages = useSetting('showProductImages');

  const cart = useCart();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<PeriodValue>(initialPeriod('today'));
  const [checkout, setCheckout] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  /**
   * Catalogue, catégories et moyens de paiement en une seule requête.
   *
   * Séparées, elles se résolvaient l'une après l'autre et provoquaient
   * autant de rendus successifs : l'écran se remplissait par morceaux, ce
   * qui donnait cette impression de vacillement à chaque arrivée sur la
   * caisse. Groupées, elles arrivent ensemble et l'écran s'affiche d'un
   * seul coup.
   */
  const catalog = useLiveQuery(async () => {
    const [categories, products, methods] = await Promise.all([
      db.categories.filter((c) => !c.archived).sortBy('position'),
      db.products.filter((p) => !p.archived).sortBy('name'),
      db.paymentMethods.filter((m) => m.enabled).sortBy('position'),
    ]);
    return { categories, products, methods };
  }, []);

  const categories = catalog?.categories ?? EMPTY<never>();
  const products = catalog?.products ?? EMPTY<never>();
  const methods = catalog?.methods ?? EMPTY<never>();

  const [methodId, setMethodId] = useState<string | null>(null);

  // On ne dépend que de l'identifiant du premier moyen de paiement :
  // le tableau `methods` est recréé à chaque notification de la base et
  // relancerait l'effet en boucle.
  const firstMethodId = methods[0]?.id ?? null;
  useEffect(() => {
    if (!methodId && firstMethodId) setMethodId(firstMethodId);
  }, [firstMethodId, methodId]);

  // Les chiffres du bandeau se recalculent quand une vente est encaissée
  // ou quand la période change.
  //
  // Les bornes sont listées une à une plutôt que l'objet `period` : React
  // compare les dépendances par référence, et cet objet est recréé à
  // chaque rendu. L'effet se relançait donc en boucle, ce qui rechargeait
  // les chiffres sans arrêt et les faisait vaciller.
  // Même principe : un seul compteur pour les deux tables.
  const counts = useLiveQuery(async () => {
    const [orders, expenses] = await Promise.all([
      db.orders.count(), db.expenses.count(),
    ]);
    return { orders, expenses };
  }, []);
  const orderCount = counts?.orders ?? 0;
  const expenseCount = counts?.expenses ?? 0;
  const { from: rangeFrom, to: rangeTo } = period.range;

  /* Les totaux sont retenus tant que ni la période ni le nombre de
     ventes ou de dépenses n'ont changé. Sans cela, revenir sur la
     caisse relançait le calcul : les tuiles se remplissaient une à
     une, dans le désordre, et les chiffres semblaient sauter d'une
     case à l'autre. */
  const stats = useCachedQuery(
    'pos:stats',
    `${rangeFrom}|${rangeTo}|${orderCount}|${expenseCount}`,
    () => summarize({ from: rangeFrom, to: rangeTo }),
  ) ?? null;

  // Douchette : le code scanné ajoute le produit au panier sans passer par
  // la recherche, même si le curseur n'est dans aucun champ.
  // L'écouteur de douchette s'installe une fois pour toutes.
  //
  // Il dépendait de `cart`, l'objet complet du store : celui-ci change à
  // chaque ajout au panier, si bien que l'écouteur était désinstallé puis
  // réinstallé sans arrêt, et toute la page se redessinait avec. Le store
  // est désormais lu au moment du scan, pas capturé dans les dépendances.
  useEffect(() => {
    return listenScanner((code) => {
      void db.products.where('barcode').equals(code).first().then((p) => {
        if (!p) { setQuery(code); return; }
        const ok = useCart.getState().add(p);
        playSound(ok ? 'scan' : 'error');
        setFlash(ok ? p.name : `${p.name} — ${useSettings.getState().t('pos.outOfStock')}`);
        setTimeout(() => setFlash(null), 1400);
      });
    });
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryId && p.categoryId !== categoryId) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q)
        || p.barcode?.includes(q)
        || p.sku?.toLowerCase().includes(q);
    });
  }, [products, categoryId, query]);

  const totals = cart.totals(taxRate);

  return (
    <div className="pos">
      <div className="pos-main">
        {/* Bandeau : totaux de la période, à la place du suivi de commandes */}
        <section className="card periods">
          <div className="periods-head">
            <h2>{t('pos.currentOrder')}</h2>
            <PeriodFilter value={period} onChange={setPeriod} />
          </div>

          <div className="kpis">
            <Kpi label={t('dash.revenue')} value={money(stats?.revenue ?? 0)} tone="accent" />
            <Kpi label={t('dash.ordersCount')} value={String(stats?.ordersCount ?? 0)} />
            <Kpi label={t('dash.avgBasket')} value={money(stats?.avgBasket ?? 0)} />
            <Kpi label={t('dash.expenses')} value={money(stats?.expenses ?? 0)} tone="warn" />
            <Kpi label={t('pay.discount')}
                 value={`− ${money(stats?.discounts ?? 0)}`}
                 tone={(stats?.discounts ?? 0) > 0 ? 'warn' : ''} />
            <Kpi label={t('dash.profit')} value={money(stats?.profit ?? 0)}
                 tone={(stats?.profit ?? 0) >= 0 ? 'ok' : 'danger'} />
          </div>
        </section>

        {/* Catégories et produits */}
        <section className="card pos-catalog">
          <div className="pos-catalog-head">
            <h2>{t('pos.categories')}</h2>
            <div className="search">
              <Icon name="search" size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder={t('pos.search')} />
              {query && <button className="clear" onClick={() => setQuery('')}>×</button>}
            </div>
          </div>

          <div className="pos-cats">
            <button className={`pos-cat ${categoryId === null ? 'on' : ''}`}
                    onClick={() => setCategoryId(null)}>
              <span className="pos-cat-ico"><CategoryIconSvg id="all" size={22} /></span>
              <small>{t('pos.allProducts')}</small>
            </button>
            {categories
              .filter((c) => products.some((p) => p.categoryId === c.id))
              .map((c) => (
              <button key={c.id} className={`pos-cat ${categoryId === c.id ? 'on' : ''}`}
                      onClick={() => setCategoryId(c.id)}>
                <span className="pos-cat-ico"><CategoryIconSvg id={c.icon} size={22} /></span>
                <small>{c.name}</small>
              </button>
            ))}
          </div>

          <div className={`pos-grid ${showImages ? 'with-img' : 'no-img'}`}>
            {visible.map((p) => (
              <ProductCard key={p.id} product={p} showImage={showImages}
                           category={categories.find((c) => c.id === p.categoryId)} />
            ))}
            {visible.length === 0 && (
              <p className="empty">{t('common.none')}</p>
            )}
          </div>
        </section>
      </div>

      {/* Panneau de vente */}
      <aside className="pos-side card">
        <h2>{t('pos.orderDetails')}</h2>

        <label className="side-one">
          <span>{t('pos.customerName')} <i>({t('common.optional')})</i></span>
          <input value={cart.customerName}
                 onChange={(e) => cart.setField('customerName', e.target.value)} />
        </label>

        <div className="lines-head">
          <h3>{t('pos.orderedItems')}</h3>
          <small>{cart.count()} {t('pos.items')}</small>
        </div>

        <div className="lines">
          {cart.lines.length === 0 && <p className="empty">{t('pos.empty')}</p>}
          {cart.lines.map((l) => {
            const stock = products.find((p) => p.id === l.productId)?.stock ?? 0;
            const atMax = l.qty >= stock;
            return (
              <div key={l.productId} className="line">
                <div className="line-info">
                  <b>{l.name}</b>
                  <small>
                    {money(l.unitPrice)} × {l.qty}
                    {atMax && <em className="line-max"> · {t('pos.maxStock')}</em>}
                  </small>
                </div>
                <div className="line-right">
                  <span className="line-total">{money(l.unitPrice * l.qty - l.discount)}</span>
                  <div className="stepper">
                    <button onClick={() => cart.setQty(l.productId, l.qty - 1)}>−</button>
                    <b>{l.qty}</b>
                    <button disabled={atMax}
                            onClick={() => cart.setQty(l.productId, l.qty + 1, stock)}>+</button>
                    <button className="del" onClick={() => cart.removeLine(l.productId)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Le moyen de paiement se choisit ici, pendant la vente, et non
            dans une fenêtre qui s'ouvre après : le caissier sait déjà
            comment le client paie au moment où il scanne. */}
        <div className="side-pay">
          <h3>{t('pay.method')}</h3>
          <div className="pay-chips">
            {methods.map((m) => (
              <button key={m.id} className={`pay-chip ${methodId === m.id ? 'on' : ''}`}
                      onClick={() => setMethodId(m.id)}>
                <span>{m.icon}</span>
                {m.name}
              </button>
            ))}
          </div>
        </div>

        {/* La remise se pose avant le récapitulatif : on la voit
            se répercuter sur le total juste en dessous. */}
        {cart.lines.length > 0 && <DiscountField subtotal={totals.subtotal} />}

        <div className="totals">
          <h3>{t('pay.details')}</h3>
          <Row label={t('pay.subtotal')} value={money(totals.subtotal)} />
          {cart.discount > 0 && <Row label={t('pay.discount')} value={`− ${money(cart.discount)}`} />}
          {/* Pas de taxe activée, pas de ligne : afficher « — » laisse
              croire à un réglage manquant. */}
          {taxRate > 0 && (
            <Row label={`${taxName || t('pay.taxes')} ${taxRate}%`}
                 value={money(totals.taxAmount)} />
          )}
          {cart.additionalFee > 0 && (
            <Row label={t('pay.additionalFee')} value={money(cart.additionalFee)} />
          )}
          <Row label={t('pay.total')} value={money(totals.total)} strong />
        </div>

        <button className="pos-checkout" disabled={cart.lines.length === 0}
                onClick={() => setCheckout(true)}>
          {t('pos.confirm')}
        </button>
      </aside>

      {flash && <div className="pos-flash">✓ {flash}</div>}

      {checkout && (
        <CheckoutDialog total={totals.total} methodId={methodId}
                        onClose={() => setCheckout(false)} />
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`row ${strong ? 'strong' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function ProductCard(
  { product, showImage, category }:
  { product: Product; showImage: boolean; category?: { name: string; icon: string } },
) {
  const money = useMoney();
  const t = useT();
  const lang = useLang();

  // La carte ne s'abonne qu'à sa propre ligne de panier : avec le store
  // entier, les quarante cartes du catalogue se redessinaient à chaque
  // ajout d'un seul article.
  const line = useCart((s) => s.lines.find((l) => l.productId === product.id));
  const qty = line?.qty ?? 0;
  const out = product.stock <= 0;

  // Une image absente ne doit pas laisser un trou : la carte se resserre et
  // le nom prend la place, comme sur une étiquette de rayon.
  // Quand les images sont activées, toutes les cartes réservent leur
  // vignette — celles qui n'ont pas de photo reçoivent un cadre
  // d'attente. Sans cela, les titres ne tombaient pas à la même hauteur
  // d'une carte à l'autre et la grille paraissait désordonnée.
  const showFrame = showImage;
  const hasImage = showImage && Boolean(product.image);

  const addOne = () => {
    if (out) return;
    const ok = useCart.getState().add(product);
    playSound(ok ? 'add' : 'error');
  };

  const removeOne = () => {
    useCart.getState().setQty(product.id, qty - 1);
    playSound('remove');
  };

  return (
    <article className={`pos-prod ${out ? 'out' : ''} ${showFrame ? 'has-img' : 'flat'}`}
             onClick={addOne}>
      {showFrame && (
        <div className="prod-img">
          {hasImage
            ? <img src={product.image!} alt="" loading="lazy" />
            : (
              // Marque d'attente : la carte garde sa forme, et l'absence
              // de photo se voit sans trouer la grille.
              <span className="prod-noimg">
                <Icon name="image" size={26} />
              </span>
            )}
          {out && <span className="badge">{t('pos.outOfStock')}</span>}
        </div>
      )}

      <div className="prod-body">
        <b className="prod-name">{product.name}</b>
        {category && (
          <span className="prod-cat">
            <CategoryIconSvg id={category.icon} size={12} />
            {category.name}
          </span>
        )}
        <small className={`prod-stock ${out ? 'danger' : product.stock <= product.stockAlert ? 'low' : ''}`}>
          {out ? t('pos.outOfStock') : withUnit(product.stock, product.unit, lang)}
        </small>
      </div>

      <div className="prod-foot">
        <b className="prod-price">{money(product.price)}</b>
        <div className="stepper sm" onClick={(e) => e.stopPropagation()}>
          <button disabled={qty === 0} onClick={removeOne}>
            <Icon name="minus" size={14} inherit />
          </button>
          <b>{qty}</b>
          <button disabled={out || qty >= product.stock} onClick={addOne}>
            <Icon name="plus" size={14} inherit />
          </button>
        </div>
      </div>
    </article>
  );
}
