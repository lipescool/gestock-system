import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, EMPTY } from '../db';
import { useSettings } from '../store/settings';
import type { Range } from '../lib/reports';
import PeriodFilter, { initialPeriod, type PeriodValue } from '../components/PeriodFilter';
import { printer } from '../print/service';
import { useCachedQuery, useCachedState } from '../lib/useCachedQuery';
import { Icon, type IconName } from '../lib/icons';
import ExportButtons from '../components/ExportButtons';
import type { Order, StockMovement, AuditLog, Product, PaymentMethod } from '../db/schema';
import './table.css';
import './history.css';

type Tab = 'all' | 'sales' | 'stock' | 'catalog' | 'money' | 'config' | 'system';

/**
 * Onglets de l'historique.
 *
 * Chacun répond à une question précise, et porte sa couleur pour qu'on
 * sache où on est sans lire l'intitulé. Les anciennes familles du journal
 * remontent ici plutôt que de rester cachées derrière un onglet
 * « Journal » qui mélangeait tout.
 */
const TABS = [
  { key: 'all', icon: 'layers', tone: 'tone-all' },
  { key: 'sales', icon: 'receipt', tone: 'tone-sales' },
  { key: 'stock', icon: 'box', tone: 'tone-stock' },
  { key: 'catalog', icon: 'tag', tone: 'tone-catalog' },
  { key: 'money', icon: 'coins', tone: 'tone-money' },
  { key: 'config', icon: 'settings', tone: 'tone-config' },
  { key: 'system', icon: 'save', tone: 'tone-system' },
] as const;

/** Types d'objets couverts par chaque onglet de journal. */
const TAB_ENTITIES: Record<string, readonly string[]> = {
  catalog: ['product', 'category'],
  money: ['discount', 'expense', 'order'],
  config: ['setting', 'paymentMethod', 'printer'],
  system: ['backup', 'system'],
};

/**
 * Combien de lignes afficher, et le bouton pour en voir plus.
 *
 * L'historique dessinait tout d'un coup : sur quelques mois de
 * ventes, cela faisait près de deux mille éléments et l'écran mettait
 * une demi-seconde à répondre. Le commerçant regarde les dernières
 * entrées, pas les mille précédentes — celles-ci s'affichent à la
 * demande.
 */
const PAR_PAGE = 60;

function useVisible<T>(rows: T[]): {
  vues: T[]; reste: number; sentinelle: (el: HTMLElement | null) => void;
} {
  const [limite, setLimite] = useState(PAR_PAGE);

  /* La limite repart du début quand la liste change : après un
     changement de période, garder « 300 lignes affichées » n'aurait
     pas de sens. */
  const [taille, setTaille] = useState(rows.length);
  if (taille !== rows.length) {
    setTaille(rows.length);
    setLimite(PAR_PAGE);
  }

  const reste = Math.max(0, rows.length - limite);

  /* Un repère invisible en bas de liste : dès qu'il entre dans la
     zone visible, la suite s'ajoute. Le commerçant fait défiler sans
     jamais rencontrer de bouton ni de numéro de page. */
  const sentinelle = useCallback((el: HTMLElement | null) => {
    if (!el || reste === 0) return;
    const obs = new IntersectionObserver((entrees) => {
      if (entrees[0]?.isIntersecting) {
        setLimite((n) => n + PAR_PAGE);
        obs.disconnect();
      }
      // La marge déclenche le chargement un peu avant le bas : la
      // suite est prête quand le regard y arrive.
    }, { rootMargin: '300px' });
    obs.observe(el);
  }, [reste]);

  return {
    vues: rows.length > limite ? rows.slice(0, limite) : rows,
    reste,
    sentinelle,
  };
}

export default function History() {
  const { t } = useSettings();
  const [tab, setTab] = useState<Tab>('all');
  const [period, setPeriod] = useState<PeriodValue>(initialPeriod('today'));

  return (
    <div className={`page hist tone-${tab}`}>
      <header className="page-head">
        <h1>{t('nav.history')}</h1>
        <PeriodFilter value={period} onChange={setPeriod} />
      </header>

      <nav className="sub-tabs">
        {TABS.map((x) => (
          <button key={x.key} className={tab === x.key ? 'on' : ''}
                  onClick={() => setTab(x.key)}>
            <Icon name={x.icon} size={16} inherit={tab === x.key} />
            {t(`hist.${x.key}`)}
          </button>
        ))}
      </nav>

      {tab === 'all' && <Everything range={period.range} />}
      {tab === 'sales' && <Sales range={period.range} />}
      {tab === 'stock' && <Movements range={period.range} />}
      {TAB_ENTITIES[tab] && (
        <Audit range={period.range} entities={TAB_ENTITIES[tab]} tone={`tone-${tab}`} />
      )}
    </div>
  );
}

/* =======================================================================
   Tout — les trois flux réunis sur une seule frise, dans l'ordre où les
   choses se sont produites. C'est la vue qui répond à « qu'est-ce qui
   s'est passé aujourd'hui ? » sans avoir à croiser trois onglets.
   ======================================================================= */

type Row =
  | { kind: 'sale'; at: number; ref: string; total: number; items: number;
      who: string | null; what: string }
  | { kind: 'move'; at: number; product: string; delta: number; after: number; reason: string }
  | { kind: 'log'; at: number; entity: string; action: string;
      detail: string; ref: string; amount: number | null;
      change: { from: unknown; to: unknown } | null };

function Everything({ range: r }: { range: Range }) {
  const { t, money } = useSettings();

  const nbProduits = useLiveQuery(() => db.products.count(), [], 0);
  const products = useCachedQuery(
    'products', String(nbProduits), () => db.products.toArray(),
  ) ?? EMPTY<Product>();
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? '—';

  /* Trois tables lues et fusionnées à chaque affichage : c'est le
     calcul le plus lourd de l'application, et il repartait de zéro à
     chaque visite. Les compteurs servent d'empreinte — une écriture
     dans l'une des tables les fait changer, et le journal se
     recalcule ; sinon il reste affiché tel quel. */
  const versions = useLiveQuery(async () => {
    const [o, m, l] = await Promise.all([
      db.orders.count(), db.stockMovements.count(), db.auditLogs.count(),
    ]);
    return `${o}|${m}|${l}`;
  }, [], '');

  const { valeur: donnees, chargement } = useCachedState(
    'hist:all',
    `${r.from}|${r.to}|${versions}`,
    async (): Promise<Row[]> => {
    const [orders, moves, logs] = await Promise.all([
      db.orders.where('createdAt').between(r.from, r.to, true, true).toArray(),
      db.stockMovements.where('createdAt').between(r.from, r.to, true, true).toArray(),
      db.auditLogs.where('createdAt').between(r.from, r.to, true, true).toArray(),
    ]);

    const out: Row[] = [
      ...orders.map((o): Row => ({
        kind: 'sale', at: o.createdAt, ref: o.ref, total: o.total,
        items: o.lines.reduce((s, l) => s + l.qty, 0),
        who: o.customerName,
        // Le contenu de la vente, pas seulement son numéro : « #GS2009-004 »
        // n'apprend rien, « 2 × POMMADE » se lit d'un coup d'œil.
        what: o.lines.map((l) => `${l.qty} × ${l.name}`).join(', '),
      })),
      ...moves.map((m): Row => ({
        kind: 'move', at: m.createdAt, product: m.productId,
        delta: m.delta, after: m.stockAfter, reason: m.reason,
      })),
      // La vente et le mouvement de stock figurent déjà au-dessus : les
      // répéter depuis le journal ferait trois lignes pour un seul acte.
      ...logs
        .filter((a) => a.entity !== 'stock' && a.entity !== 'order')
        .map((a): Row => {
          const ref = refOf(a.after) || refOf(a.before);
          const fromOrder = ref
            ? orders.find((o) => o.ref === ref)?.lines
                .map((l) => `${l.qty} × ${l.name}`).join(', ') ?? ''
            : '';
          return {
          kind: 'log', at: a.createdAt, entity: a.entity, action: a.action,
          // Le nom journalisé, ou à défaut le contenu du ticket : jamais
          // la référence seule, qui n'apprend rien.
          detail: subject(a.after) || subject(a.before) || fromOrder,
          ref: '',
          amount: amountOf(a.after) ?? amountOf(a.before),
          change: a.entity === 'setting'
            ? { from: valueOf(a.before), to: valueOf(a.after) }
            : null,
          };
        }),
    ];

    return out.sort((a, b) => b.at - a.at);
  });

  const rows = donnees ?? EMPTY<Row>();

  const { vues, reste, sentinelle } = useVisible(rows);

  /* Tant que le calcul tourne, l'écran n'affiche rien plutôt qu'un
     tableau vide : sinon on voyait « 0 entrée » et une liste vide,
     puis tout apparaissait d'un coup. Le test vient après les
     crochets — React exige qu'ils soient tous appelés à chaque
     rendu, dans le même ordre. */
  if (chargement) return <div className="hist-attente" />;

  return (
    <>
      <div className="hist-bar tone-all">
        <span>{rows.length} {t('hist.entries')}</span>
        <ExportButtons
          rows={rows}
          title={t('hist.all')}
          columns={[
            { header: t('exp.date'), value: (r) => new Date(r.at).toLocaleString() },
            { header: t('hist.type'),
              value: (r) => r.kind === 'sale' ? t('hist.sale')
                          : r.kind === 'move' ? t('hist.stock')
                          : t(`ent.${r.entity}`) },
            { header: t('hist.detail'),
              value: (r) => r.kind === 'sale' ? (r.what || r.ref)
                          : r.kind === 'move' ? nameOf(r.product)
                          : r.detail },
            { header: t('pay.total'),
              value: (r) => r.kind === 'sale' ? money(r.total)
                          : r.kind === 'move' ? `${r.delta > 0 ? '+' : ''}${r.delta}`
                          : (r.amount !== null ? money(r.amount) : ''),
              numeric: true },
          ]}
        />
      </div>

      <div className="hist-scroll">
        {rows.length === 0 && <p className="empty">{t('common.none')}</p>}
        <div className="row-head all-head">
          <span>{t('exp.date')}</span>
          <span />
          <span>{t('hist.detail')}</span>
          <span />
          <span className="r">{t('pay.total')}</span>
        </div>

        <ul className="feed-all">
          {vues.map((row, i) => (
            <li key={i} className={row.kind}>
              <time title={new Date(row.at).toLocaleString()}>{shortDate(row.at)}</time>

              <span className="dot-mark" aria-hidden />

              {/* Le titre porte l'information complète : ce qui s'est
                  passé, sur quoi, et de combien. Éclatée en colonnes,
                  la même information obligeait à recomposer la phrase. */}
              {row.kind === 'sale' && (
                <>
                  <span className="what">
                    <Icon name="receipt" size={14} />
                    <b>{row.what || row.ref}</b>
                    <i>({t('hist.sale')} {money(row.total)})</i>
                  </span>
                  <span className="det">{row.who || '—'}</span>
                  <b className="val sale">{money(row.total)}</b>
                </>
              )}

              {row.kind === 'move' && (
                <>
                  <span className="what">
                    <Icon name="box" size={14} />
                    <b>{nameOf(row.product)}</b>
                    <i>
                      ({t(`log.${row.reason}`)} {row.delta > 0 ? '+' : ''}{row.delta},{' '}
                      {t('hist.after')} {row.after})
                    </i>
                  </span>
                  <span className="reason-cell">
                    <em className={`reason ${row.reason}`}>{t(`log.${row.reason}`)}</em>
                  </span>
                  <b className={`val ${row.delta < 0 ? 'neg' : 'pos'}`}>
                    {row.delta > 0 ? '+' : ''}{row.delta}
                  </b>
                </>
              )}

              {row.kind === 'log' && (
                <>
                  <span className="what">
                    <Icon name={entityIcon(row.entity)} size={14} />
                    <b>
                      {row.entity === 'setting'
                        ? t(`setting.${row.detail}`)
                        : (row.detail || t(`ent.${row.entity}`))}
                    </b>
                    <i>
                      {row.change
                        ? `(${settingValue(row.change.from, t)} → ${settingValue(row.change.to, t)})`
                        : `(${phrase(row.entity, row.action, t)}${
                            row.amount !== null ? ` ${money(row.amount)}` : ''})`}
                    </i>
                  </span>
                  <span className="det">{t(`log.${row.action}`)}</span>
                  {row.amount !== null ? (
                    <b className={`val ${row.entity === 'expense' ? 'neg' : 'dim'}`}>
                      {row.entity === 'expense' ? '− ' : ''}{money(row.amount)}
                    </b>
                  ) : <b className="val dim">—</b>}
                </>
              )}
            </li>
          ))}
        </ul>

        {/* Repère de fin de liste : sa seule présence déclenche le
            chargement de la suite. */}
        {reste > 0 && <div ref={sentinelle} className="hist-sentinelle" aria-hidden />}
      </div>
    </>
  );
}

/* =======================================================================
   Ventes — présentées comme des tickets : la référence et le montant
   dominent, le reste est secondaire.
   ======================================================================= */

/* Exporté : l'onglet Ventes de Stock affiche la même liste. La
   recopier ferait diverger les deux écrans dès la première
   correction. */
export function Sales({ range: r, search = '' }: { range: Range; search?: string }) {
  const { t, money, settings } = useSettings();
  const [open, setOpen] = useState<Order | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  /* Comme le journal, la liste des ventes est retenue : sans cela,
     elle se relisait entièrement à chaque passage sur l'onglet. */
  const nbVentes = useLiveQuery(() => db.orders.count(), [], 0);

  const { valeur: ventesBrutes, chargement } = useCachedState(
    'hist:sales',
    `${r.from}|${r.to}|${nbVentes}`,
    () => db.orders.where('createdAt').between(r.from, r.to, true, true)
            .reverse().sortBy('createdAt'),
  );
  const toutes = ventesBrutes ?? EMPTY<Order>();

  /* La recherche porte sur ce que le commerçant a sous les yeux : le
     numéro du ticket, le nom du client, et les produits vendus — c'est
     souvent par l'article qu'on retrouve une vente. */
  const orders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return toutes;
    return toutes.filter((o) =>
      o.ref.toLowerCase().includes(q)
      || (o.customerName ?? '').toLowerCase().includes(q)
      || o.lines.some((l) => l.name.toLowerCase().includes(q)));
  }, [toutes, search]);

  const methods = useLiveQuery(() => db.paymentMethods.toArray(), []) ?? EMPTY<PaymentMethod>();
  const total = orders.filter((o) => o.status === 'paid').reduce((s, o) => s + o.total, 0);

  /* Le total porte sur toutes les ventes de la période, pas seulement
     sur celles affichées : c'est le chiffre de la période qui compte,
     pas celui de ce qu'on a fait défiler. */
  const { vues: ventesVues, reste: resteVentes, sentinelle: sentVentes } =
    useVisible(orders);

  /* Rien ne s'affiche tant que le calcul tourne : sinon l'onglet
     montre « 0 » et une liste vide, puis tout apparaît d'un coup. */
  if (chargement) return <div className="hist-attente" />;


  const reprint = async (order: Order) => {
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
      const method = order.paymentMethodId
        ? await db.paymentMethods.get(order.paymentMethodId) : null;
      await printer.printReceipt(order, {
        shopName: settings.shopName,
        address: (await db.settings.get('shopAddress'))?.value as string ?? '',
        phone: (await db.settings.get('shopPhone'))?.value as string ?? '',
        footer: settings.receiptFooter,
        currency: settings.currency, lang: settings.lang, width: settings.printWidth,
        paymentMethod: method ?? null,
        labels: {
          subtotal: t('pay.subtotal'), taxes: settings.taxName || t('pay.taxes'), discount: t('pay.discount'),
          fee: t('pay.additionalFee'), total: t('pay.total'), method: t('pay.method'),
          received: t('pay.received'), change: t('pay.change'),
          items: t('pos.items'), cashier: t('set.users'),
        },
      });
    } catch (e) {
      /* L'échec était avalé en silence : le commerçant cliquait sur
         « Réimprimer », rien ne sortait, et rien ne le lui disait. */
      const code = e instanceof Error ? e.message : 'ERROR';
      setPrintError(
        code === 'RELAY_PRINTER_OFFLINE' ? t('print.printerOffline')
        : code === 'RELAY_PRINTER_ERROR' ? t('print.printerError')
        : code === 'NotFoundError' ? t('print.cancelled')
        : t('print.reprintFailed'),
      );
      // Le message s'efface seul : c'est une information, pas une
      // erreur qui demande une décision.
      setTimeout(() => setPrintError(null), 6000);
    }
  };

  return (
    <>
      {printError && <p className="hist-print-err">{printError}</p>}

      <div className="hist-bar tone-sales">
        <span>{orders.length} {t('hist.sales').toLowerCase()}</span>
        <b>{money(total)}</b>
        <ExportButtons
          rows={orders}
          title={t('hist.sales')}
          summary={`${t('pay.total')} ${money(total)}`}
          columns={[
            { header: t('exp.date'), value: (o) => new Date(o.createdAt).toLocaleString() },
            { header: t('stock.products'),
              value: (o) => o.lines.map((l) => `${l.qty} x ${l.name}`).join(', ') },
            { header: t('pos.customerName'), value: (o) => o.customerName ?? '' },
            { header: t('pay.method'),
              value: (o) => methods.find((m) => m.id === o.paymentMethodId)?.name ?? '' },
            { header: t('pay.total'), value: (o) => money(o.total), numeric: true },
          ]}
        />
      </div>

      <div className="hist-scroll">
        {orders.length === 0 && <p className="empty">{t('common.none')}</p>}
        {/* Une liste de lignes, comme les autres onglets : les cartes
            obligeaient à balayer la page en zigzag pour lire des ventes
            qui se consultent dans l'ordre. */}
        <div className="row-head sales-head">
          <span>{t('exp.date')}</span>
          <span>{t('stock.products')}</span>
          <span>{t('pos.customerName')}</span>
          <span>{t('pay.method')}</span>
          <span className="r">{t('pay.total')}</span>
          <span>{' '}</span>
        </div>

        <ul className="sales-list">
          {ventesVues.map((o) => (
            <li key={o.id} className={o.status !== 'paid' ? 'void' : ''}
                onClick={() => setOpen(o)}>
              <time title={new Date(o.createdAt).toLocaleString()}>{shortDate(o.createdAt)}</time>

              <span className="what">
                <Icon name="receipt" size={14} />
                <b>{o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</b>
              </span>

              <span className="det">
                {o.customerName || '—'}
              </span>

              <span className="pay">
                <em>{methods.find((m) => m.id === o.paymentMethodId)?.name ?? '—'}</em>
              </span>

              <b className="amount">{money(o.total)}</b>

              {/* En toutes lettres, comme les actions des autres écrans :
                  une imprimante seule ne dit pas s'il s'agit d'imprimer
                  ou de réimprimer. */}
              <span className="act-cell">
                <button className="act" onClick={(e) => { e.stopPropagation(); void reprint(o); }}>
                  {t('hist.reprint')}
                </button>
              </span>
            </li>
          ))}
        </ul>

        {resteVentes > 0 && <div ref={sentVentes} className="hist-sentinelle" aria-hidden />}
      </div>

      {open && <TicketDialog order={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function TicketDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t, money } = useSettings();
  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <header className="dlg-head">
          <h2>{order.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</h2>
          <button className="dlg-x" onClick={onClose}>×</button>
        </header>
        <p className="dlg-note">
          {order.ref} · {new Date(order.createdAt).toLocaleString()}
        </p>
        <div className="recap">
          {order.lines.map((l) => (
            <div key={l.productId} className="recap-line">
              <span>{l.qty} × {l.name}</span>
              <b>{money(l.unitPrice * l.qty - l.discount)}</b>
            </div>
          ))}
          <div className="recap-line total">
            <span>{t('pay.total')}</span>
            <b>{money(order.total)}</b>
          </div>
        </div>
        <button className="dlg-primary" onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  );
}

/* =======================================================================
   Mouvements de stock — une frise : chaque ligne montre le sens du
   mouvement par une flèche colorée et le stock avant/après.
   ======================================================================= */

function Movements({ range: r }: { range: Range }) {
  const { t } = useSettings();

  const nbMouv = useLiveQuery(() => db.stockMovements.count(), [], 0);

  const { valeur: mouvBruts, chargement } = useCachedState(
    'hist:moves',
    `${r.from}|${r.to}|${nbMouv}`,
    () => db.stockMovements.where('createdAt').between(r.from, r.to, true, true)
            .reverse().sortBy('createdAt'),
  );
  const rows = mouvBruts ?? EMPTY<StockMovement>();

  const nbProduits = useLiveQuery(() => db.products.count(), [], 0);
  const products = useCachedQuery(
    'products', String(nbProduits), () => db.products.toArray(),
  ) ?? EMPTY<Product>();
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? '—';

  const { vues: mouvVues, reste: resteMouv, sentinelle: sentMouv } = useVisible(rows);

  /* Rien ne s'affiche tant que le calcul tourne : sinon l'onglet
     montre « 0 » et une liste vide, puis tout apparaît d'un coup. */
  if (chargement) return <div className="hist-attente" />;


  /* Les totaux portent sur toute la période, pas sur les seules
     lignes affichées : ce sont les entrées et sorties réelles qui
     intéressent, pas celles qu'on a fait défiler. */
  const inQty = rows.filter((m) => m.delta > 0).reduce((s, m) => s + m.delta, 0);
  const outQty = rows.filter((m) => m.delta < 0).reduce((s, m) => s + Math.abs(m.delta), 0);

  // Le stock du moment, tous produits confondus : les entrées et sorties
  // de la période ne disent rien de ce qu'il reste en rayon.
  const totalStock = products.reduce((s, p) => s + p.stock, 0);

  return (
    <>
      {/* Chaque chiffre porte son intitulé : « +145 −100 » posé seul ne
          dit ni ce qui est entré, ni ce qui reste. */}
      <div className="hist-bar tone-stock">
        <span>{rows.length} {t('hist.movements')}</span>
        <span className="split">
          <span className="stat">
            {t('hist.entered')} <b className="in">+{inQty}</b>
          </span>
          <span className="stat">
            {t('hist.left')} <b className="out">−{outQty}</b>
          </span>
          <span className="stat">
            {t('hist.currentStock')} <b>{totalStock}</b>
          </span>
        </span>
        <ExportButtons
          rows={rows}
          title={t('hist.stock')}
          summary={`+${inQty} / -${outQty}`}
          columns={[
            { header: t('exp.date'), value: (m) => new Date(m.createdAt).toLocaleString() },
            { header: t('common.reason'), value: (m) => t(`log.${m.reason}`) },
            { header: t('stock.product'), value: (m) => nameOf(m.productId) },
            { header: t('stock.quantity'),
              value: (m) => `${m.delta > 0 ? '+' : ''}${m.delta}`, numeric: true },
            { header: t('hist.after'), value: (m) => String(m.stockAfter), numeric: true },
            { header: t('common.note'), value: (m) => m.note ?? '' },
          ]}
        />
      </div>

      <div className="hist-scroll">
        {rows.length === 0 && <p className="empty">{t('common.none')}</p>}
        <div className="row-head moves-head">
          <span>{t('exp.date')}</span>
          <span>{t('common.reason')}</span>
          <span>{t('stock.product')}</span>
          <span>{t('stock.quantity')}</span>
        </div>

        <ul className="moves">
          {mouvVues.map((m) => (
            <li key={m.id} className={m.delta < 0 ? 'neg' : 'pos'}>
              <time title={new Date(m.createdAt).toLocaleString()}>
                {shortDate(m.createdAt)}
              </time>

              {/* Le motif est écrit en toutes lettres : une flèche seule
                  ne dit pas si la sortie vient d'une vente ou d'une perte. */}
              <span className="reason-cell">
                <em className={`reason ${m.reason}`}>{t(`log.${m.reason}`)}</em>
              </span>

              <div className="move-body">
                <b>{nameOf(m.productId)}</b>
                {/* Ce qui s'est passé, entre parenthèses : le motif, la
                    variation et le stock restant. La note libre vient en
                    dernier, c'est un commentaire, pas l'information. */}
                <small>
                  ({t(`log.${m.reason}`)} {m.delta > 0 ? '+' : ''}{m.delta},{' '}
                  {t('hist.after')} {m.stockAfter}
                  {m.note ? ` — ${m.note}` : ''})
                </small>
              </div>

              <div className="move-num">
                <b className="delta">{m.delta > 0 ? '+' : ''}{m.delta}</b>
                <small>{t('hist.after')} {m.stockAfter}</small>
              </div>
            </li>
          ))}
        </ul>

        {resteMouv > 0 && <div ref={sentMouv} className="hist-sentinelle" aria-hidden />}
      </div>
    </>
  );
}

/* =======================================================================
   Journal — un fil chronologique dense, en petite police monospace :
   c'est un relevé technique, pas un tableau de gestion.
   ======================================================================= */

/** Rend lisible la valeur d'un réglage journalisé. */
function settingValue(v: unknown, t: (k: string) => string): string {
  if (typeof v === 'boolean') return t(v ? 'common.on' : 'common.off');
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/**
 * Date courte, pour les colonnes des listes.
 *
 * `toLocaleString()` produit « 20/09/2026 14:32:11 » : trop long pour une
 * colonne, et l'année comme les secondes n'apprennent rien dans une liste
 * déjà filtrée par période. La date complète reste dans l'infobulle.
 */
function shortDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Le nom de l'objet concerné, tel qu'il figure dans le journal. */
function subject(row: unknown): string {
  if (!row || typeof row !== 'object') return '';
  const o = row as Record<string, unknown>;
  if (typeof o.name === 'string') return o.name;
  if (typeof o.label === 'string') return o.label;
  // La référence ne sert jamais de titre : « #GS2009-008 » n'apprend rien.
  // Les entrées enregistrées avant que les noms soient journalisés n'ont
  // que cette référence ; elles tombent alors sur le libellé générique,
  // et la référence part dans la parenthèse.
  return '';
}

/** La référence de la vente concernée, quand le journal la porte. */
function refOf(row: unknown): string {
  if (!row || typeof row !== 'object') return '';
  const o = row as Record<string, unknown>;
  return typeof o.ref === 'string' ? o.ref : '';
}

/** La valeur brute portée par un enregistrement de réglage. */
function valueOf(row: unknown): unknown {
  if (!row || typeof row !== 'object') return null;
  return (row as Record<string, unknown>).value ?? null;
}

/** Le montant journalisé, s'il y en a un. */
function amountOf(row: unknown): number | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  if (typeof o.amount === 'number') return o.amount;
  if (typeof o.total === 'number') return o.total;
  return null;
}

/**
 * Phrase décrivant ce qui s'est passé.
 *
 * « Remise création » ne se lit pas : une remise s'accorde, un produit se
 * crée, une sauvegarde se lance. Chaque objet a son verbe.
 */
function phrase(entity: string, action: string, t: (k: string) => string): string {
  const key = `act.${entity}.${action}`;
  const custom = t(key);
  // `t` renvoie la clé quand la traduction manque : on retombe alors sur
  // la forme générique « Objet action ».
  if (custom !== key) return custom;
  return `${t(`ent.${entity}`)} ${t(`log.${action}`).toLowerCase()}`;
}

/** Icône assortie au type d'objet touché. */
function entityIcon(entity: string): IconName {
  switch (entity) {
    case 'expense': return 'expenses';
    case 'product': return 'box';
    case 'category': return 'layers';
    case 'paymentMethod': return 'card';
    case 'discount': return 'percent';
    case 'printer': return 'print';
    case 'setting': return 'settings';
    case 'backup': return 'save';
    default: return 'settings';
  }
}

/** Un objet JSON brut n'apprend rien au commerçant : on en tire l'essentiel. */
function describe(after: unknown, t: (k: string) => string): string {
  if (!after || typeof after !== 'object') return '';
  const o = after as Record<string, unknown>;
  const parts: string[] = [];
  // Le nom est déjà affiché à part : ici on ne garde que les chiffres.
  if (typeof o.stock === 'number') parts.push(`${t('stock.quantity')} ${o.stock}`);
  if (typeof o.enabled === 'boolean') parts.push(t(o.enabled ? 'common.on' : 'common.off'));
  return parts.join(' · ');
}

function Audit(
  { range: r, entities, tone }:
  { range: Range; entities: readonly string[]; tone: string },
) {
  const { t, money } = useSettings();

  const nbLogs = useLiveQuery(() => db.auditLogs.count(), [], 0);

  const { valeur: logsBruts, chargement } = useCachedState(
    `hist:audit:${entities.join(',')}`,
    `${r.from}|${r.to}|${nbLogs}`,
    () => db.auditLogs.where('createdAt').between(r.from, r.to, true, true)
            .reverse().sortBy('createdAt'),
  );
  const rows = logsBruts ?? EMPTY<AuditLog>();

  // Les entrées enregistrées avant que les noms soient journalisés ne
  // portent qu'une référence de vente. On retrouve alors le contenu du
  // ticket pour dire de quels produits il s'agissait.
  const nbCmd = useLiveQuery(() => db.orders.count(), [], 0);

  const orders = useCachedQuery(
    'hist:audit:orders',
    `${r.from}|${r.to}|${nbCmd}`,
    () => db.orders.where('createdAt').between(r.from, r.to, true, true).toArray(),
  ) ?? EMPTY<Order>();

  /* Rien ne s'affiche tant que le calcul tourne : sinon l'onglet
     montre « 0 » et une liste vide, puis tout apparaît d'un coup. */
  if (chargement) return <div className="hist-attente" />;

  const contentOf = (ref: string): string => {
    const o = orders.find((x: Order) => x.ref === ref);
    return o ? o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ') : '';
  };

  // Le stock a son propre onglet : le répéter ici ferait deux lignes pour
  // un seul mouvement.
  const shown = rows.filter(
    (a) => a.entity !== 'stock' && entities.includes(a.entity),
  );

  return (
    <>
      <div className={`hist-bar ${tone}`}>
        <span>{shown.length} {t('hist.entries')}</span>
        <ExportButtons
          rows={shown}
          title={t('nav.history')}
          columns={[
            { header: t('exp.date'), value: (a) => new Date(a.createdAt).toLocaleString() },
            { header: t('hist.type'), value: (a) => t(`ent.${a.entity}`) },
            { header: t('hist.action'), value: (a) => t(`log.${a.action}`) },
            { header: t('hist.detail'),
              value: (a) => subject(a.after) || subject(a.before) || '' },
          ]}
        />
      </div>

      <div className="hist-scroll">
        {shown.length === 0 && <p className="empty">{t('common.none')}</p>}
        {/* En-tête de colonnes : sans lui, chaque ligne semblait commencer
            à un endroit différent selon la longueur de son contenu. */}
        <div className="row-head feed-head">
          <span>{t('exp.date')}</span>
          <span>{t('hist.type')}</span>
          <span>{t('hist.action')}</span>
          <span>{t('hist.detail')}</span>
        </div>

        <ul className="feed">
          {shown.map((a) => (
            <li key={a.id}>
              <time title={new Date(a.createdAt).toLocaleString()}>{shortDate(a.createdAt)}</time>
              <span className="entity-cell">
                <em className="entity">{t(`ent.${a.entity}`)}</em>
              </span>
              <span className="action-cell">
                <em className="action">{t(`log.${a.action}`)}</em>
              </span>
              <span className="detail">
                <b>
                  {(() => {
                    if (a.entity === 'setting') {
                      return t(`setting.${subject(a.after) || subject(a.before)}`);
                    }
                    const name = subject(a.after) || subject(a.before);
                    if (name) return name;
                    // Pas de nom en base : on le reconstitue depuis la vente.
                    const ref = refOf(a.after) || refOf(a.before);
                    return (ref && contentOf(ref)) || t(`ent.${a.entity}`);
                  })()}
                </b>
                {(() => {
                  if (a.entity === 'setting') {
                    const from = settingValue(valueOf(a.before), t);
                    const to = settingValue(valueOf(a.after), t);
                    return <em>({from} → {to})</em>;
                  }
                  const amt = amountOf(a.after) ?? amountOf(a.before);
                  const rest = describe(a.after, t);
                  const bits = [
                    phrase(a.entity, a.action, t),
                    amt !== null ? money(amt) : '',
                    rest,
                  ].filter(Boolean);
                  return <em>({bits.join(' ')})</em>;
                })()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
