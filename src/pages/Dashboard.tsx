import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, EMPTY } from '../db';
import { useT, useMoney, useLang } from '../store/settings';
import { summarize, topProducts, type TopProduct } from '../lib/reports';
import { useCachedQuery } from '../lib/useCachedQuery';
import PeriodFilter, { initialPeriod, type PeriodValue } from '../components/PeriodFilter';
import './dashboard.css';
import { withUnit } from '../lib/units';

export default function Dashboard() {
  // Sélecteurs ciblés : `useSettings()` abonne au store entier et fait
  // redessiner la page au moindre changement sans rapport.
  const t = useT();
  const money = useMoney();
  const lang = useLang();
  const [period, setPeriod] = useState<PeriodValue>(initialPeriod('today'));


  // Une seule requête plutôt que deux : séparées, elles se résolvaient
  // l'une après l'autre et l'écran se remplissait en deux temps.
  const counts = useLiveQuery(async () => {
    const [orders, expenses] = await Promise.all([
      db.orders.count(), db.expenses.count(),
    ]);
    return { orders, expenses };
  }, []);
  const orderCount = counts?.orders ?? 0;
  const expenseCount = counts?.expenses ?? 0;

  // Voir Pos.tsx : dépendre de l'objet `period` relançait l'effet à chaque
  // rendu, puisque React compare les dépendances par référence.
  const { from: rangeFrom, to: rangeTo } = period.range;

  /* Le résultat est retenu tant que ni la période ni le nombre de
     ventes ou de dépenses n'ont bougé. En revenant sur l'écran, les
     chiffres sont déjà là : ils ne repassent plus par un état vide,
     et la base n'est pas relue pour rien. */
  const donnees = useCachedQuery(
    'dashboard',
    `${rangeFrom}|${rangeTo}|${orderCount}|${expenseCount}`,
    async () => {
      const r = { from: rangeFrom, to: rangeTo };
      const [s, tp] = await Promise.all([summarize(r), topProducts(r, 8)]);
      return { stats: s, top: tp };
    },
  );

  const stats = donnees?.stats ?? null;
  const top = donnees?.top ?? EMPTY<TopProduct>();

  /* Le stock des produits change à chaque vente : la somme des
     quantités sert d'empreinte, un simple comptage ne verrait pas
     qu'un article est passé sous son seuil. */
  const stockVersion = useLiveQuery(async () => {
    const ps = await db.products.toArray();
    return ps.reduce((s, p) => s + p.stock, 0) + ':' + ps.length;
  }, [], '');

  const lowStock = useCachedQuery(
    'dash:lowStock',
    String(stockVersion),
    () => db.products.filter((p) => !p.archived && p.stock <= p.stockAlert).toArray(),
  ) ?? EMPTY<never>();

  const expenseRows = useCachedQuery(
    'dash:expenses',
    `${rangeFrom}|${rangeTo}|${expenseCount}`,
    () => db.expenses
      .where('spentAt').between(rangeFrom, rangeTo, true, true)
      .reverse().sortBy('spentAt'),
  ) ?? EMPTY<never>();

  /** Ventes ayant donné lieu à une remise, pour savoir sur quoi elles ont porté. */
  const discountRows = useCachedQuery(
    'dash:discounts',
    `${rangeFrom}|${rangeTo}|${orderCount}`,
    async () => {
      const orders = await db.orders
        .where('createdAt').between(rangeFrom, rangeTo, true, true)
        .filter((o) => o.status === 'paid')
        .reverse().sortBy('createdAt');

      return orders
        .map((o) => ({
          id: o.id,
          what: o.lines.map((l) => `${l.qty} × ${l.name}`).join(', '),
          amount: o.discount + o.lines.reduce((sum, l) => sum + l.discount, 0),
        }))
        .filter((r) => r.amount > 0);
    },
  ) ?? EMPTY<never>();

  return (
    <div className="page dash">
      <header className="page-head">
        <h1>{t('nav.dashboard')}</h1>
        <PeriodFilter value={period} onChange={setPeriod} />
      </header>

      <div className="dash-scroll">
        <div className="kpis big">
          <div className="kpi accent">
            <small>{t('dash.revenue')}</small>
            <b>{money(stats?.revenue ?? 0)}</b>
          </div>
          <div className="kpi warn">
            <small>{t('dash.expenses')}</small>
            <b>{money(stats?.expenses ?? 0)}</b>
          </div>
          <div className="kpi">
            <small>{t('dash.grossMargin')}</small>
            <b>{money(stats?.grossMargin ?? 0)}</b>
          </div>
          <div className={`kpi ${(stats?.discounts ?? 0) > 0 ? 'warn' : ''}`}>
            <small>{t('pay.discount')} ({stats?.discountCount ?? 0})</small>
            <b>− {money(stats?.discounts ?? 0)}</b>
          </div>
          <div className={`kpi ${(stats?.profit ?? 0) >= 0 ? 'ok' : 'danger'}`}>
            <small>{t('dash.profit')}</small>
            <b>{money(stats?.profit ?? 0)}</b>
          </div>
          <div className="kpi">
            <small>{t('dash.ordersCount')}</small>
            <b>{stats?.ordersCount ?? 0}</b>
          </div>
          <div className="kpi">
            <small>{t('dash.avgBasket')}</small>
            <b>{money(stats?.avgBasket ?? 0)}</b>
          </div>
        </div>

        <div className="dash-cols">
          <section className="card">
            <h2>{t('dash.topProducts')}</h2>
            {top.length === 0 && <p className="empty">{t('common.none')}</p>}
            <ol className="rank">
              {top.map((p, i) => (
                <li key={p.productId}>
                  <span className="n">{i + 1}</span>
                  <span className="nm">{p.name}</span>
                  <span className="q">{p.qty} {t('dash.sold')}</span>
                  <b>{money(p.revenue)}</b>
                </li>
              ))}
            </ol>
          </section>

          <section className="card">
            <h2>{t('dash.expenseDetail')}</h2>
            {expenseRows.length === 0 && <p className="empty">{t('common.none')}</p>}
            <ul className="lowlist">
              {expenseRows.slice(0, 10).map((e) => (
                <li key={e.id}>
                  <span className="nm">{e.label}</span>
                  <b className="exp-amt">{money(e.amount)}</b>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>{t('dash.discountDetail')}</h2>
            {discountRows.length === 0 && <p className="empty">{t('common.none')}</p>}
            <ul className="lowlist">
              {discountRows.slice(0, 10).map((d: { id: string; what: string; amount: number }) => (
                <li key={d.id}>
                  <span className="nm">{d.what}</span>
                  <b className="disc-amt">− {money(d.amount)}</b>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>{t('dash.lowStock')}</h2>
            {lowStock.length === 0 && <p className="empty">{t('common.none')}</p>}
            <ul className="lowlist">
              {lowStock.slice(0, 10).map((p) => (
                <li key={p.id}>
                  <span className="nm">{p.name}</span>
                  <span className={`pill ${p.stock <= 0 ? 'danger' : 'warn'}`}>
                    {withUnit(p.stock, p.unit, lang)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
