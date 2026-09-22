import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, now, EMPTY } from '../db';
import { logAudit } from '../db/audit';
import { useSettings } from '../store/settings';
import { CATEGORY_ICONS, CategoryIconSvg, DEFAULT_ICON } from '../lib/categoryIcons';
import { Icon } from '../lib/icons';
import ConfirmDialog, { useConfirm } from './ConfirmDialog';
import ExportButtons from './ExportButtons';
import './category.css';

/**
 * Gestion des catégories, en pleine page plutôt qu'en fenêtre.
 *
 * Les catégories se règlent une fois puis se consultent souvent : une boîte
 * de dialogue qu'il faut rouvrir à chaque coup d'œil gêne plus qu'elle
 * n'aide. Ici, on les voit en même temps que le nombre de produits qu'elles
 * contiennent.
 */
export default function CategoriesPanel() {
  const { t } = useSettings();

  const categories = useLiveQuery(() => db.categories.orderBy('position').toArray(), []) ?? EMPTY<never>();
  const products = useLiveQuery(() => db.products.filter((p) => !p.archived).toArray(), []) ?? EMPTY<never>();

  const countOf = (id: string) => products.filter((p) => p.categoryId === id).length;

  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [editingId, setEditingId] = useState<string | null>(null);
  const del = useConfirm<{ id: string; name: string }>();

  const reset = () => { setName(''); setIcon(DEFAULT_ICON); setEditingId(null); };

  const save = async () => {
    // Les noms sont stockés en majuscules : c'est ainsi qu'ils s'affichent
    // en caisse et s'impriment sur les étiquettes.
    const label = name.trim().toUpperCase();
    if (!label) return;

    if (editingId) {
      const before = await db.categories.get(editingId);
      await db.categories.update(editingId, { name: label, icon, updatedAt: now() });
      await logAudit({ entity: 'category', entityId: editingId, action: 'update',
                       before, after: { name: label, icon } });
    } else {
      const id = uid();
      await db.categories.add({
        id, name: label, icon, position: categories.length,
        archived: false, updatedAt: now(),
      });
      await logAudit({ entity: 'category', entityId: id, action: 'create',
                       after: { name: label, icon } });
    }
    reset();
  };

  const edit = (id: string) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    setEditingId(id);
    setName(c.name);
    setIcon(c.icon);
  };

  const remove = async (id: string) => {
    // Les produits ne sont pas supprimés avec la catégorie : ils repassent
    // simplement en « sans catégorie ».
    await db.products.where('categoryId').equals(id).modify({ categoryId: null });
    const gone = categories.find((c) => c.id === id);
    await db.categories.delete(id);
    await logAudit({
      entity: 'category', entityId: id, action: 'delete',
      before: gone ? { name: gone.name } : null,
    });
    if (editingId === id) reset();
  };

  const move = async (id: string, dir: -1 | 1) => {
    const i = categories.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= categories.length) return;
    await db.categories.update(categories[i].id, { position: j, updatedAt: now() });
    await db.categories.update(categories[j].id, { position: i, updatedAt: now() });
  };

  return (
    <div className="cats-panel">
      {/* Formulaire */}
      <section className="card cat-form">
        <h2>{editingId ? t('common.edit') : t('cat.add')}</h2>

        <label className="set-field">
          <span>{t('cat.name')}</span>
          <input value={name} placeholder={t('cat.name')}
                 onChange={(e) => setName(e.target.value.toUpperCase())}
                 onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </label>

        <div className="set-field">
          <span>{t('cat.icon')}</span>
          <div className="icon-picker">
            {CATEGORY_ICONS.filter((ic) => ic.id !== 'all').map((ic) => (
              <button key={ic.id} title={ic.label}
                      className={`icon-opt ${icon === ic.id ? 'on' : ''}`}
                      onClick={() => setIcon(ic.id)}>
                <CategoryIconSvg id={ic.id} size={22} />
              </button>
            ))}
          </div>
        </div>

        <div className="cat-form-acts">
          {editingId && (
            <button className="btn ghost" onClick={reset}>{t('common.cancel')}</button>
          )}
          <button className="btn primary" disabled={!name.trim()} onClick={() => void save()}>
            {editingId ? t('common.save') : t('cat.add')}
          </button>
        </div>
      </section>

      {/* Liste */}
      <section className="card cat-list-card">
        {/* Titre et export sur la même ligne : les boutons n'ont pas
            besoin d'une ligne à eux. */}
        <div className="cat-list-head">
          <h2>
            {t('pos.categories')}
            <small>{categories.length} · {t('cat.orderHint')}</small>
          </h2>

          <ExportButtons
            rows={categories}
            title={t('pos.categories')}
            summary={`${categories.length}`}
            columns={[
              { header: t('cat.order'),
                value: (c) => String(categories.findIndex((x) => x.id === c.id) + 1),
                numeric: true },
              { header: t('cat.name'), value: (c) => c.name },
              { header: t('stock.products'),
                value: (c) => String(countOf(c.id)), numeric: true },
            ]}
          />
        </div>

        {categories.length === 0 && <p className="hint">{t('cat.empty')}</p>}

        <div className="cat-list">
          {categories.map((c, i) => (
            <div key={c.id} className={`cat-row ${editingId === c.id ? 'on' : ''}`}>
              {/* Le rang est écrit : les flèches seules ne disaient pas
                  qu'elles servaient à ordonner la bande de la caisse. */}
              <span className="cat-rank" title={t('cat.order')}>{i + 1}</span>
              <span className="cat-row-ico"><CategoryIconSvg id={c.icon} size={20} /></span>

              <div className="cat-row-body">
                <b>{c.name}</b>
                <small>{countOf(c.id)} {t('stock.products').toLowerCase()}</small>
              </div>

              <div className="cat-row-acts">
                <button className="icon" disabled={i === 0}
                        onClick={() => void move(c.id, -1)} title={t('cat.moveUp')}>
                  <Icon name="up" size={14} />
                </button>
                <button className="icon" disabled={i === categories.length - 1}
                        onClick={() => void move(c.id, 1)} title={t('cat.moveDown')}>
                  <Icon name="down" size={14} />
                </button>
                <button className="act" onClick={() => edit(c.id)}>
                  {t('common.edit')}
                </button>
                <button className="act danger" onClick={() => del.ask(c)}>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {del.target && (
        <ConfirmDialog
          title={t('common.delete')}
          subject={del.target.name}
          amount={`${countOf(del.target.id)} ${t('stock.products').toLowerCase()}`}
          message={t('cat.confirmDelete')}
          onConfirm={() => remove(del.target!.id)}
          onClose={del.close}
        />
      )}
    </div>
  );
}
