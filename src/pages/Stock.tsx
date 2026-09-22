import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, now, EMPTY, EMPTY_MAP } from '../db';
import { applyStockMovement, logAudit } from '../db/audit';
import { useSettings } from '../store/settings';
import { parseMoney } from '../i18n/currencies';
import { generateInternalBarcode, buildLabelSheetHtml } from '../lib/barcode';
import { CategoryIconSvg } from '../lib/categoryIcons';
import CategoriesPanel from '../components/CategoriesPanel';
import { Icon } from '../lib/icons';
import Select from '../components/Select';
import ExportButtons from '../components/ExportButtons';
import PeriodFilter, { initialPeriod, type PeriodValue } from '../components/PeriodFilter';
import { Sales } from './History';
import type { Product, Category } from '../db/schema';
import './table.css';
import { withUnit, plural } from '../lib/units';

export default function Stock() {
  const { t, money, settings } = useSettings();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'products' | 'categories' | 'sales'>('products');
  /* L'onglet Ventes a sa propre période : celle du stock n'a pas de
     sens ici, et l'inverse non plus. */
  const [salesPeriod, setSalesPeriod] = useState<PeriodValue>(initialPeriod('today'));
  /* Recherche propre aux ventes : celle du haut filtre les produits,
     mêler les deux rendrait le résultat incompréhensible. */
  const [salesQuery, setSalesQuery] = useState('');
  const [removing, setRemoving] = useState<Product | null>(null);
  const [filterCat, setFilterCat] = useState('');
  const [filterStock, setFilterStock] = useState<'all' | 'low' | 'out' | 'ok'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'priceUp' | 'priceDown' | 'stockUp' | 'soldDown'>('name');

  const produitsBruts = useLiveQuery(
    () => db.products.filter((p) => !p.archived).sortBy('name'), []);
  const products = produitsBruts ?? EMPTY<never>();

  // Cumul des ventes par produit : il vient du journal de stock, qui est la
  // seule source qui n'oublie rien, même si une vente a été remboursée.
  const ventesParProduit = useLiveQuery(async () => {
    const moves = await db.stockMovements.where('reason').equals('sale').toArray();
    const map: Record<string, number> = {};
    for (const m of moves) map[m.productId] = (map[m.productId] ?? 0) + Math.abs(m.delta);
    return map;
  }, []);

  /**
   * Entrées et sorties décidées par quelqu'un, ventes exclues.
   *
   * Les ventes ont déjà leur colonne. Ce qu'on veut voir ici, c'est ce que
   * les gens ont ajouté ou retiré à la main : livraisons, pertes, retours,
   * corrections d'inventaire.
   */
  const mouvementsParProduit = useLiveQuery(async () => {
    const all = await db.stockMovements.toArray();
    const map: Record<string, { in: number; out: number; last: number }> = {};
    for (const m of all) {
      if (m.reason === 'sale') continue;
      const slot = map[m.productId] ?? { in: 0, out: 0, last: 0 };
      if (m.delta > 0) slot.in += m.delta;
      else slot.out += Math.abs(m.delta);
      slot.last = Math.max(slot.last, m.createdAt);
      map[m.productId] = slot;
    }
    return map;
  }, []);

  const categoriesBrutes = useLiveQuery(
    () => db.categories.orderBy('position').toArray(), []);

  const soldByProduct = ventesParProduit ?? (EMPTY_MAP as Record<string, never>);
  const movesByProduct = mouvementsParProduit ?? (EMPTY_MAP as Record<string, never>);
  const categories = categoriesBrutes ?? EMPTY<never>();

  /* Tant qu'une des quatre lectures n'a pas répondu, l'écran n'affiche
     rien : sinon le tableau apparaît vide, les compteurs à zéro, puis
     tout se remplit d'un coup. */
  const chargement = produitsBruts === undefined || ventesParProduit === undefined
    || mouvementsParProduit === undefined || categoriesBrutes === undefined;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    const rows = products.filter((p) => {
      if (q && !(p.name.toLowerCase().includes(q)
                 || p.barcode?.includes(q)
                 || p.sku?.toLowerCase().includes(q))) return false;

      if (filterCat === 'none') { if (p.categoryId) return false; }
      else if (filterCat && p.categoryId !== filterCat) return false;

      if (filterStock === 'out' && p.stock > 0) return false;
      if (filterStock === 'low' && !(p.stock > 0 && p.stock <= p.stockAlert)) return false;
      if (filterStock === 'ok' && p.stock <= p.stockAlert) return false;

      return true;
    });

    // Le tri s'applique après le filtre, sur une copie : `products` vient
    // de la base et ne doit pas être réordonné en place.
    return [...rows].sort((a, b) => {
      switch (sortBy) {
        case 'priceUp': return a.price - b.price;
        case 'priceDown': return b.price - a.price;
        case 'stockUp': return a.stock - b.stock;
        case 'soldDown': return (soldByProduct[b.id] ?? 0) - (soldByProduct[a.id] ?? 0);
        default: return a.name.localeCompare(b.name);
      }
    });
    // `soldByProduct` n'entre pas dans les dépendances : c'est un objet
    // recréé à chaque notification de la base, qui relancerait le calcul
    // indéfiniment. Seul le tri « les plus vendus » s'en sert, et il se
    // recalcule de toute façon quand la liste des produits change.
  }, [products, query, filterCat, filterStock, sortBy]);

  const filtersOn = filterCat !== '' || filterStock !== 'all' || sortBy !== 'name';

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const printLabels = () => {
    const items = products
      .filter((p) => selected.has(p.id) && p.barcode)
      .map((p) => ({ name: p.name, barcode: p.barcode!, price: money(p.price), qty: 1 }));
    if (!items.length) return;

    const html = buildLabelSheetHtml(items, settings.printWidth === 80 ? '80x80' : '58x40');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    frame.contentDocument!.write(html);
    frame.contentDocument!.close();
    setTimeout(() => { frame.contentWindow?.print(); setTimeout(() => frame.remove(), 60_000); }, 400);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('nav.stock')}</h1>
        {tab === 'sales' && (
          <div className="page-tools stock-tools">
            <div className="search">
              <Icon name="search" size={16} />
              <input value={salesQuery}
                     onChange={(e) => setSalesQuery(e.target.value)}
                     placeholder={t('hist.searchSales')} />
            </div>
            <PeriodFilter value={salesPeriod} onChange={setSalesPeriod} />
          </div>
        )}
        {tab === 'products' && (
          <div className="page-tools">
            <div className="search">
              <Icon name="search" size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder={t('pos.search')} />
            </div>
            {selected.size > 0 && (
              <button className="btn ghost" onClick={printLabels}>
                <Icon name="tag" size={15} /> {t('stock.printLabels')} ({selected.size})
              </button>
            )}

            {/* L'export reprend la liste telle qu'elle est filtrée et
                triée à l'écran : c'est ce que le commerçant a sous les
                yeux qu'il veut emporter, pas le catalogue entier. */}
            <ExportButtons
              rows={visible}
              title={t('stock.products')}
              summary={`${visible.length} / ${products.length}`}
              columns={[
                { header: t('stock.product'), value: (p) => p.name },
                { header: t('stock.category'),
                  value: (p) => categories.find((c) => c.id === p.categoryId)?.name ?? '' },
                { header: t('stock.barcode'), value: (p) => p.barcode ?? '' },
                { header: t('stock.cost'), value: (p) => money(p.cost), numeric: true },
                { header: t('stock.price'), value: (p) => money(p.price), numeric: true },
                { header: t('stock.quantity'),
                  value: (p) => withUnit(p.stock, p.unit, settings.lang), numeric: true },
                { header: t('stock.alert'), value: (p) => String(p.stockAlert), numeric: true },
                { header: t('stock.sold'),
                  value: (p) => String(soldByProduct[p.id] ?? 0), numeric: true },
                { header: t('hist.entered'),
                  value: (p) => String(movesByProduct[p.id]?.in ?? 0), numeric: true },
                { header: t('hist.left'),
                  value: (p) => String(movesByProduct[p.id]?.out ?? 0), numeric: true },
              ]}
            />

            <button className="btn primary" onClick={() => setEditing('new')}>
              <Icon name="plus" size={16} inherit /> {t('stock.addProduct')}
            </button>
          </div>
        )}
      </header>

      {/* Deux onglets : les catégories ont leur propre écran plutôt qu'une
          fenêtre qui se referme. On les voit, on les range, on les garde
          sous les yeux en même temps que les produits. */}
      {tab === 'products' && (
        <div className="filters">
          <Select
            value={filterCat}
            onChange={setFilterCat}
            placeholder={t('pos.categories')}
            options={[
              { value: '', label: t('stock.allCategories') },
              { value: 'none', label: t('common.none') },
              ...categories.map((c) => ({
                value: c.id, label: c.name,
                prefix: <CategoryIconSvg id={c.icon} size={16} />,
              })),
            ]}
          />
          <Select
            value={filterStock}
            onChange={(v) => setFilterStock(v as typeof filterStock)}
            options={[
              { value: 'all', label: t('stock.allStock') },
              { value: 'ok', label: t('stock.inStock') },
              { value: 'low', label: t('dash.lowStock') },
              { value: 'out', label: t('pos.outOfStock') },
            ]}
          />
          <Select
            value={sortBy}
            onChange={(v) => setSortBy(v as typeof sortBy)}
            options={[
              { value: 'name', label: t('stock.sortName') },
              { value: 'priceUp', label: t('stock.sortPriceUp') },
              { value: 'priceDown', label: t('stock.sortPriceDown') },
              { value: 'stockUp', label: t('stock.sortStockUp') },
              { value: 'soldDown', label: t('stock.sortSold') },
            ]}
          />
          {filtersOn && (
            <button className="btn ghost" onClick={() => {
              setFilterCat(''); setFilterStock('all'); setSortBy('name');
            }}>
              {t('stock.clearFilters')}
            </button>
          )}
          <span className="filters-count">
            {visible.length} / {products.length}
          </span>

        </div>
      )}

      <nav className="sub-tabs">
        <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>
          <Icon name="box" size={16} inherit={tab === 'products'} />
          {t('stock.products')}
        </button>
        <button className={tab === 'categories' ? 'on' : ''} onClick={() => setTab('categories')}>
          <Icon name="layers" size={16} inherit={tab === 'categories'} />
          {t('pos.categories')}
        </button>
        <button className={tab === 'sales' ? 'on' : ''} onClick={() => setTab('sales')}>
          <Icon name="receipt" size={16} inherit={tab === 'sales'} />
          {t('hist.sales')}
        </button>
      </nav>

      {/* Les ventes réutilisent la liste de l'historique, avec son
          propre filtre de période. */}
      {tab === 'sales' && (
        <Sales range={salesPeriod.range} search={salesQuery} />
      )}

      {/* Le titre et les onglets restent visibles pendant la lecture :
          seul le tableau attend. Sinon l'écran entier disparaît puis
          revient, ce qui est plus brutal qu'un chiffre qui se corrige. */}
      {tab === 'sales' ? null : tab === 'categories' ? <CategoriesPanel /> : chargement ? (
        <div className="table-attente" />
      ) : (

      <div className="table-wrap card">
        <table className="table">
          <thead>
            <tr>
              <th className="pick"></th>
              <th>{t('stock.product')}</th>
              <th>{t('stock.category')}</th>
              <th>{t('stock.barcode')}</th>
              <th>{t('stock.cost')}</th>
              <th>{t('stock.price')}</th>
              <th>{t('stock.quantity')}</th>
              <th>{t('stock.sold')}</th>
              <th>{t('hist.entered')}</th>
              <th>{t('hist.left')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const low = p.stock <= p.stockAlert;
              return (
                <tr key={p.id} className={p.stock <= 0 ? 'row-out' : low ? 'row-low' : ''}>
                  <td className="pick">
                    <input type="checkbox" checked={selected.has(p.id)}
                           onChange={() => toggle(p.id)} />
                  </td>
                  <td><b>{p.name}</b></td>
                  <td>
                    {(() => {
                      const c = categories.find((x) => x.id === p.categoryId);
                      return c ? (
                        <span className="cat-inline">
                          <CategoryIconSvg id={c.icon} size={15} /> {c.name}
                        </span>
                      ) : <span className="dimmed">{t('common.none')}</span>;
                    })()}
                  </td>
                  <td className="mono">{p.barcode ?? '—'}</td>
                  <td>{money(p.cost)}</td>
                  <td><b>{money(p.price)}</b></td>
                  <td>
                    <span className={`pill ${p.stock <= 0 ? 'danger' : low ? 'warn' : 'ok'}`}>
                      {withUnit(p.stock, p.unit, settings.lang)}
                    </span>
                  </td>
                  <td>
                    <span className="sold">{soldByProduct[p.id] ?? 0}</span>
                  </td>
                  <td className="nowrap">
                    {(() => {
                      const m = movesByProduct[p.id];
                      return m && m.in > 0
                        ? <b className="mv-in">+{m.in}</b>
                        : <span className="dimmed">—</span>;
                    })()}
                  </td>
                  <td className="nowrap">
                    {(() => {
                      const m = movesByProduct[p.id];
                      return m && m.out > 0
                        ? <b className="mv-out">−{m.out}</b>
                        : <span className="dimmed">—</span>;
                    })()}
                  </td>
                  <td className="nowrap">
                    {/* Libellés plutôt qu'icônes : « ajuster » et « modifier »
                        sont deux actions proches, une icône ne les sépare pas
                        assez clairement. */}
                    <button className="act" onClick={() => setAdjusting(p)}>
                      {t('stock.adjust')}
                    </button>
                    <button className="act primary" onClick={() => setEditing(p)}>
                      {t('common.edit')}
                    </button>
                    <button className="act danger" onClick={() => setRemoving(p)}>
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={11} className="empty">{t('common.none')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      )}

      {editing && (
        <ProductDialog product={editing === 'new' ? null : editing}
                       categories={categories}
                       onClose={() => setEditing(null)} />
      )}
      {adjusting && (
        <AdjustDialog product={adjusting} onClose={() => setAdjusting(null)} />
      )}
      {removing && (
        <DeleteProductDialog product={removing}
                             sold={soldByProduct[removing.id] ?? 0}
                             onClose={() => setRemoving(null)} />
      )}

    </div>
  );
}

/* ---- Fiche produit ---- */

function ProductDialog({ product, categories, onClose }:
{ product: Product | null; categories: Category[]; onClose: () => void }) {
  const { t, currencyInfo } = useSettings();
  const cur = currencyInfo();
  const toInput = (v: number) => (cur.decimals === 0 ? String(v) : (v / 10 ** cur.decimals).toString());

  const [f, setF] = useState({
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? '',
    barcode: product?.barcode ?? '',
    sku: product?.sku ?? '',
    price: product ? toInput(product.price) : '',
    cost: product ? toInput(product.cost) : '',
    stock: product ? String(product.stock) : '',
    stockAlert: String(product?.stockAlert ?? 5),
    unit: product?.unit ?? t('stock.unitDefault'),
    image: product?.image ?? null as string | null,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const pickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setF({ ...f, image: reader.result as string });
    reader.readAsDataURL(file);
  };

  /** Entier positif, ou null si la saisie n'en est pas un. */
  const parseCount = (v: string): number | null => {
    const raw = v.trim();
    if (raw === '') return null;
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  };

  /**
   * Chaque champ est vérifié séparément et signalé à sa place.
   * Sans cela, une saisie du genre « 2000FFF » était silencieusement
   * ramenée à 2000, et un produit pouvait être créé sans prix ni quantité.
   */
  const validate = (): { price: number; cost: number; stock: number; alert: number } | null => {
    const errs: Record<string, string> = {};

    if (!f.name.trim()) errs.name = t('err.required');

    const price = parseMoney(f.price, cur);
    if (price === null) errs.price = t('err.amount');
    else if (price <= 0) errs.price = t('err.positive');

    // Le prix d'achat est facultatif, mais s'il est renseigné il doit être
    // un montant : la marge en dépend.
    const cost = f.cost.trim() === '' ? 0 : parseMoney(f.cost, cur);
    if (cost === null) errs.cost = t('err.amount');

    // Un produit sans stock n'a rien à faire en caisse : il ne serait pas
    // vendable. La quantité est exigée à la création. En modification, en
    // revanche, un stock tombé à zéro est un état normal qu'on doit pouvoir
    // enregistrer sans être bloqué.
    const stock = parseCount(f.stock);
    if (stock === null) errs.stock = t('err.count');
    else if (!product && stock <= 0) errs.stock = t('err.stockRequired');

    const alert = parseCount(f.stockAlert);
    if (alert === null) errs.stockAlert = t('err.count');

    if (!f.unit.trim()) errs.unit = t('err.required');

    setErrors(errs);
    if (Object.keys(errs).length > 0) return null;

    return { price: price!, cost: cost!, stock: stock!, alert: alert! };
  };

  const save = async () => {
    const valid = validate();
    if (!valid) return;
    const { price, cost, stock } = valid;
    const stockAlert = valid.alert;

    if (product) {
      const patch = {
        name: f.name.trim().toUpperCase(), categoryId: f.categoryId || null,
        barcode: f.barcode.trim() || null, sku: f.sku.trim() || null,
        price, cost, stockAlert,
        unit: f.unit.trim(), image: f.image, updatedAt: now(),
      };
      await db.products.update(product.id, patch);
      await logAudit({
        entity: 'product', entityId: product.id, action: 'update',
        before: { name: product.name, price: product.price },
        after: { name: patch.name, price: patch.price },
      });
      // Un changement de quantité depuis la fiche passe par le journal,
      // comme n'importe quel autre mouvement.
      if (stock !== product.stock) {
        await applyStockMovement({
          productId: product.id, delta: stock - product.stock,
          reason: 'inventory', note: t('stock.fromForm'),
        });
      }
    } else {
      const id = uid();
      const row: Product = {
        id, name: f.name.trim().toUpperCase(), categoryId: f.categoryId || null,
        barcode: f.barcode.trim() || await codeLibre(),
        sku: f.sku.trim() || null, price, cost, stock: 0,
        stockAlert, unit: f.unit.trim(),
        image: f.image, tags: [], archived: false, updatedAt: now(),
      };
      await db.products.add(row);
      await logAudit({
        entity: 'product', entityId: id, action: 'create',
        // On journalise les champs utiles à la relecture, pas la fiche
        // entière : l'image en base64 rendrait le journal illisible.
        after: { name: row.name, price: row.price, stock },
      });
      if (stock > 0) {
        await applyStockMovement({ productId: id, delta: stock, reason: 'initial' });
      }
    }
    onClose();
  };

  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <header className="dlg-head">
          <h2>{product ? t('common.edit') : t('stock.addProduct')}</h2>
          <button className="dlg-x" onClick={onClose}>×</button>
        </header>

        <label className="dlg-field">
          <span>{t('stock.product')} *</span>
          <input value={f.name} autoFocus className={errors.name ? 'bad' : ''}
                 onChange={(e) => setF({ ...f, name: e.target.value.toUpperCase() })} />
          {errors.name && <em className="field-err">{errors.name}</em>}
        </label>

        <div className="dlg-row">
          <label className="dlg-field">
            <span>{t('pos.categories')}</span>
            <Select
              value={f.categoryId}
              onChange={(v) => setF({ ...f, categoryId: v })}
              options={[
                { value: '', label: t('common.none') },
                ...categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                  prefix: <CategoryIconSvg id={c.icon} size={17} />,
                })),
              ]}
            />
          </label>
          <label className="dlg-field">
            <span>{t('stock.barcode')}</span>
            <input value={f.barcode} placeholder={t('common.auto')}
                   onChange={(e) => setF({ ...f, barcode: e.target.value })} />
          </label>
        </div>

        <div className="dlg-row">
          <label className="dlg-field">
            <span>{t('stock.cost')}</span>
            <input inputMode="decimal" value={f.cost} className={errors.cost ? 'bad' : ''}
                   onChange={(e) => setF({ ...f, cost: e.target.value })} />
            {errors.cost && <em className="field-err">{errors.cost}</em>}
          </label>
          <label className="dlg-field">
            <span>{t('stock.price')} *</span>
            <input inputMode="decimal" value={f.price} className={errors.price ? 'bad' : ''}
                   onChange={(e) => setF({ ...f, price: e.target.value })} />
            {errors.price && <em className="field-err">{errors.price}</em>}
          </label>
        </div>

        <div className="dlg-row">
          <label className="dlg-field">
            <span>{t('stock.quantity')} *</span>
            <input inputMode="numeric" value={f.stock} className={errors.stock ? 'bad' : ''}
                   onChange={(e) => setF({ ...f, stock: e.target.value })} />
            {errors.stock && <em className="field-err">{errors.stock}</em>}
          </label>
          <label className="dlg-field">
            <span>{t('stock.alert')}</span>
            <input inputMode="numeric" value={f.stockAlert}
                   className={errors.stockAlert ? 'bad' : ''}
                   onChange={(e) => setF({ ...f, stockAlert: e.target.value })} />
            {errors.stockAlert && <em className="field-err">{errors.stockAlert}</em>}
          </label>
          <label className="dlg-field">
            <span>{t('stock.unit')} *</span>
            <input value={f.unit} className={errors.unit ? 'bad' : ''}
                   onChange={(e) => setF({ ...f, unit: e.target.value })} />
            {errors.unit && <em className="field-err">{errors.unit}</em>}
          </label>
        </div>

        <label className="dlg-field">
          <span>{t('common.image')}</span>
          <input type="file" accept="image/*"
                 onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
        </label>

        <div className="dlg-actions">
          <button className="dlg-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="dlg-primary" onClick={() => void save()}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Un code-barres interne qui n'est pris par aucun produit.
 *
 * Le tirage au sort rend une collision très improbable — un milliard
 * de combinaisons — mais « très improbable » n'est pas « impossible »,
 * et deux produits partageant un code fausseraient les ventes. On
 * vérifie donc, et on retire au besoin.
 */
async function codeLibre(): Promise<string> {
  for (let essai = 0; essai < 20; essai++) {
    const code = generateInternalBarcode();
    const pris = await db.products.filter((p) => p.barcode === code).count();
    if (pris === 0) return code;
  }
  // Vingt échecs de suite ne se produiront pas ; si cela arrivait, un
  // code fondé sur l'heure reste préférable à aucun code.
  return generateInternalBarcode();
}

/* ---- Ajustement de stock ---- */

function AdjustDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<'purchase' | 'loss' | 'return' | 'adjustment'>('purchase');
  const [note, setNote] = useState('');

  const value = Number(delta) || 0;
  const signed = reason === 'loss' ? -Math.abs(value) : Math.abs(value);

  const apply = async () => {
    if (value === 0) return;
    await applyStockMovement({
      productId: product.id, delta: signed, reason, note: note.trim() || null,
    });
    onClose();
  };

  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <header className="dlg-head">
          <h2>{t('stock.adjust')}</h2>
          <button className="dlg-x" onClick={onClose}>×</button>
        </header>

        <p className="dlg-note">{product.name} — {withUnit(product.stock, product.unit, lang)}</p>

        <div className="seg">
          {(['purchase', 'loss', 'return', 'adjustment'] as const).map((k) => (
            <button key={k} className={reason === k ? 'on' : ''} onClick={() => setReason(k)}>
              {t(`log.${k}`)}
            </button>
          ))}
        </div>

        <label className="dlg-field">
          <span>{t('stock.quantity')}</span>
          <input inputMode="numeric" value={delta} autoFocus
                 onChange={(e) => setDelta(e.target.value.replace(/[^\d]/g, ''))} />
        </label>

        <label className="dlg-field">
          <span>{t('common.reason')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <p className="dlg-preview">
          {product.stock} → <b>{product.stock + signed}</b>{' '}
          {plural(product.stock + signed, product.unit, lang)}
        </p>

        <div className="dlg-actions">
          <button className="dlg-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="dlg-primary" disabled={value === 0}
                  onClick={() => void apply()}>{t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Suppression d'un produit ---- */

function DeleteProductDialog(
  { product, sold, onClose }: { product: Product; sold: number; onClose: () => void },
) {
  const { t } = useSettings();
  const [busy, setBusy] = useState(false);

  /**
   * Un produit déjà vendu n'est pas effacé mais archivé : ses ventes
   * passées le citent, et le supprimer pour de bon laisserait des lignes
   * d'historique orphelines. Un produit jamais vendu, lui, disparaît
   * vraiment — il n'a laissé aucune trace ailleurs.
   */
  const hasHistory = sold > 0;

  const confirm = async () => {
    setBusy(true);
    try {
      if (hasHistory) {
        await db.products.update(product.id, { archived: true, updatedAt: now() });
        await logAudit({
          entity: 'product', entityId: product.id, action: 'archive',
          before: { name: product.name, stock: product.stock },
        });
      } else {
        await db.stockMovements.where('productId').equals(product.id).delete();
        await db.products.delete(product.id);
        await logAudit({
          entity: 'product', entityId: product.id, action: 'delete',
          before: { name: product.name, stock: product.stock },
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <header className="dlg-head">
          <h2>{t('common.delete')}</h2>
          <button className="dlg-x" onClick={onClose}>×</button>
        </header>

        <p className="dlg-note">{product.name}</p>

        <p className="hint">
          {hasHistory
            ? t('stock.archiveHint', { count: sold })
            : t('stock.deleteHint')}
        </p>

        <div className="dlg-actions">
          <button className="dlg-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="dlg-danger" disabled={busy} onClick={() => void confirm()}>
            {hasHistory ? t('stock.archive') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
