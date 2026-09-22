import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, now, EMPTY } from '../db';
import { logAudit } from '../db/audit';
import { useSettings } from '../store/settings';
import { parseMoney } from '../i18n/currencies';
import PeriodFilter, { initialPeriod, type PeriodValue } from '../components/PeriodFilter';
import { Icon } from '../lib/icons';
import Select from '../components/Select';
import ConfirmDialog, { useConfirm } from '../components/ConfirmDialog';
import ExportButtons from '../components/ExportButtons';
import { PayIcon } from '../lib/payIcons';
import type { Expense } from '../db/schema';
import '../components/category.css';
import './table.css';

export default function Expenses() {
  const { t, money } = useSettings();
  const [period, setPeriod] = useState<PeriodValue>(initialPeriod('month'));
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [manageCats, setManageCats] = useState(false);
  const del = useConfirm<Expense>();

  const range = period.range;
  const depensesBrutes = useLiveQuery(
    () => db.expenses.where('spentAt').between(range.from, range.to, true, true)
            .reverse().sortBy('spentAt'),
    [range.from, range.to],
  );

  const catsBrutes = useLiveQuery(() => db.expenseCategories.toArray(), []);

  const rows = depensesBrutes ?? EMPTY<never>();
  const cats = catsBrutes ?? EMPTY<never>();
  const total = rows.reduce((s, e) => s + e.amount, 0);

  /* Tant qu'une des deux lectures n'a pas répondu, le tableau n'est
     pas affiché : sinon on voit « 0 FCFA » et une liste vide, puis
     tout se remplit. */
  const chargement = depensesBrutes === undefined || catsBrutes === undefined;

  const remove = async (e: Expense) => {
    await db.expenses.delete(e.id);
    await logAudit({
      entity: 'expense', entityId: e.id, action: 'delete',
      before: { label: e.label, amount: e.amount },
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('nav.expenses')}</h1>
        <div className="page-tools">
          <PeriodFilter value={period} onChange={setPeriod} />
          <button className="btn ghost" onClick={() => setManageCats(true)}>
            <Icon name="layers" size={15} /> {t('exp.manageCats')}
          </button>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} inherit /> {t('exp.add')}
          </button>
        </div>
      </header>

      {/* Les exports rejoignent la ligne des totaux plutôt que la barre
          d'outils, déjà chargée. Deux tuiles laissent la place à droite,
          et l'export porte justement sur ce que ces chiffres résument. */}
      <div className="exp-summary">
        <div className="kpis">
          <div className="kpi warn">
            <small>{t('dash.expenses')} — {t(`period.${period.period}`)}</small>
            <b>{money(total)}</b>
          </div>
          <div className="kpi">
            <small>{t('common.count')}</small>
            <b>{rows.length}</b>
          </div>
        </div>

        <ExportButtons
          rows={rows}
          title={t('nav.expenses')}
          period={t(`period.${period.period}`)}
          summary={money(total)}
          columns={[
            { header: t('exp.date'), value: (e) => new Date(e.spentAt).toLocaleDateString() },
            { header: t('exp.label'), value: (e) => e.label },
            { header: t('exp.category'),
              value: (e) => cats.find((c) => c.id === e.categoryId)?.name ?? '' },
            { header: t('exp.amount'), value: (e) => money(e.amount), numeric: true },
            { header: t('common.note'), value: (e) => e.note ?? '' },
          ]}
        />
      </div>

      {/* Le tableau attend d'avoir ses données : le bandeau du haut,
          lui, reste en place. */}
      {chargement ? <div className="table-attente" /> : (
      <div className="table-wrap card">
        <table className="table">
          <thead>
            <tr>
              <th>{t('exp.date')}</th>
              <th>{t('exp.label')}</th>
              <th>{t('exp.category')}</th>
              <th>{t('exp.amount')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="mono">{new Date(e.spentAt).toLocaleDateString()}</td>
                <td><b>{e.label}</b>{e.note && <small>{e.note}</small>}</td>
                <td>{cats.find((c) => c.id === e.categoryId)?.name ?? '—'}</td>
                <td><b>{money(e.amount)}</b></td>
                <td className="nowrap">
                  {/* En toutes lettres, comme dans Stock : une corbeille
                      et un crayon se confondent vite quand on va vite. */}
                  <button className="act primary" onClick={() => setEditing(e)}>
                    {t('common.edit')}
                  </button>
                  <button className="act danger" onClick={() => del.ask(e)}>
                    {t('common.delete')}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="empty">{t('common.none')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {editing && (
        <ExpenseDialog expense={editing === 'new' ? null : editing}
                       onClose={() => setEditing(null)} />
      )}
      {manageCats && <ExpenseCatsDialog onClose={() => setManageCats(false)} />}

      {del.target && (
        <ConfirmDialog
          title={t('common.delete')}
          subject={del.target.label}
          amount={money(del.target.amount)}
          message={t('exp.confirmDelete')}
          onConfirm={() => remove(del.target!)}
          onClose={del.close}
        />
      )}
    </div>
  );
}

/**
 * Convertit une date de formulaire (« 2026-09-20 ») en horodatage local,
 * fixé à midi. Passer par `new Date(chaîne)` donnerait minuit UTC, ce qui
 * décale la dépense d'un jour dans la plupart des fuseaux.
 */
function toInputDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function atNoon(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return Date.now();
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

function ExpenseDialog({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const { t, currencyInfo } = useSettings();
  const cur = currencyInfo();
  const cats = useLiveQuery(() => db.expenseCategories.toArray(), []) ?? EMPTY<never>();
  const methods = useLiveQuery(
    () => db.paymentMethods.filter((m) => m.enabled).sortBy('position'), []) ?? EMPTY<never>();

  const [f, setF] = useState({
    label: expense?.label ?? '',
    amount: expense ? String(expense.amount / 10 ** cur.decimals) : '',
    categoryId: expense?.categoryId ?? '',
    paymentMethodId: expense?.paymentMethodId ?? '',
    note: expense?.note ?? '',
    // `toISOString()` bascule en UTC : une dépense de 20 h pouvait
    // réafficher la date du lendemain. On compose la date à la main.
    date: toInputDate(expense?.spentAt ?? Date.now()),
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Voir Pos.tsx : le tableau est recréé à chaque notification de la base.
  const firstMethodId = methods[0]?.id ?? null;
  useEffect(() => {
    if (!f.paymentMethodId && firstMethodId) {
      setF((s) => ({ ...s, paymentMethodId: firstMethodId }));
    }
  }, [firstMethodId, f.paymentMethodId]);

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!f.label.trim()) errs.label = t('err.required');

    const amount = parseMoney(f.amount, cur);
    if (amount === null) errs.amount = t('err.amount');
    else if (amount <= 0) errs.amount = t('err.positive');

    setErrors(errs);
    if (Object.keys(errs).length > 0 || amount === null) return;

    const base = {
      label: f.label.trim(),
      amount,
      categoryId: f.categoryId || null,
      paymentMethodId: f.paymentMethodId || null,
      note: f.note.trim() || null,
      // `new Date("2026-09-20")` vaut minuit UTC, pas minuit ici. Selon le
      // fuseau, la dépense tombait la veille et n'apparaissait pas dans les
      // totaux du jour. On l'ancre à midi, heure locale : aucun décalage
      // horaire ne peut alors la faire changer de journée.
      spentAt: atNoon(f.date),
      updatedAt: now(),
    };

    if (expense) {
      await db.expenses.update(expense.id, base);
      await logAudit({
        entity: 'expense', entityId: expense.id, action: 'update',
        before: { label: expense.label, amount: expense.amount },
        after: { label: base.label, amount: base.amount },
      });
    } else {
      const id = uid();
      const row: Expense = { id, ...base, attachment: null, userId: null, createdAt: now() };
      await db.expenses.add(row);
      await logAudit({
        entity: 'expense', entityId: id, action: 'create',
        after: { label: row.label, amount: row.amount },
      });
    }
    onClose();
  };

  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <header className="dlg-head">
          <h2>{expense ? t('common.edit') : t('exp.add')}</h2>
          <button className="dlg-x" onClick={onClose}>×</button>
        </header>

        <label className="dlg-field">
          <span>{t('exp.label')} *</span>
          <input value={f.label} autoFocus className={errors.label ? 'bad' : ''}
                 onChange={(e) => setF({ ...f, label: e.target.value })} />
          {errors.label && <em className="field-err">{errors.label}</em>}
        </label>

        <div className="dlg-row">
          <label className="dlg-field">
            <span>{t('exp.amount')} *</span>
            <input inputMode="decimal" value={f.amount} className={errors.amount ? 'bad' : ''}
                   onChange={(e) => setF({ ...f, amount: e.target.value })} />
            {errors.amount && <em className="field-err">{errors.amount}</em>}
          </label>
          <label className="dlg-field">
            <span>{t('exp.date')}</span>
            <input type="date" value={f.date}
                   onChange={(e) => setF({ ...f, date: e.target.value })} />
          </label>
        </div>

        <div className="dlg-row">
          <label className="dlg-field">
            <span>{t('exp.category')}</span>
            <Select
              value={f.categoryId}
              onChange={(v) => setF({ ...f, categoryId: v })}
              options={[
                { value: '', label: t('common.none') },
                ...cats.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </label>
          <label className="dlg-field">
            <span>{t('pay.method')}</span>
            <Select
              value={f.paymentMethodId}
              onChange={(v) => setF({ ...f, paymentMethodId: v })}
              options={methods.map((m) => ({
                value: m.id,
                label: m.name,
                prefix: <PayIcon id={m.icon} size={17} />,
              }))}
            />
          </label>
        </div>

        <label className="dlg-field">
          <span>{t('common.note')}</span>
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </label>

        <div className="dlg-actions">
          <button className="dlg-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="dlg-primary" onClick={() => void save()}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Catégories de dépenses ---- */

function ExpenseCatsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useSettings();
  const cats = useLiveQuery(() => db.expenseCategories.toArray(), []) ?? EMPTY<never>();
  const rows = useLiveQuery(() => db.expenses.toArray(), []) ?? EMPTY<never>();
  const [name, setName] = useState('');
  const del = useConfirm<{ id: string; name: string }>();

  const countOf = (id: string) => rows.filter((e) => e.categoryId === id).length;

  const add = async () => {
    const label = name.trim();
    if (!label) return;
    const id = uid();
    await db.expenseCategories.add({ id, name: label, updatedAt: now() });
    await logAudit({ entity: 'category', entityId: id, action: 'create',
                     after: { name: label } });
    setName('');
  };

  const rename = async (id: string, value: string) => {
    await db.expenseCategories.update(id, { name: value, updatedAt: now() });
  };

  const remove = async (id: string) => {
    // Les dépenses restent, elles repassent simplement sans catégorie.
    const gone = cats.find((c) => c.id === id);
    await db.expenses.where('categoryId').equals(id).modify({ categoryId: null });
    await db.expenseCategories.delete(id);
    await logAudit({ entity: 'category', entityId: id, action: 'delete',
                     before: gone ? { name: gone.name } : null });
  };

  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg wide" onClick={(e) => e.stopPropagation()}>
        <header className="dlg-head">
          <h2>{t('exp.manageCats')}</h2>
          <button className="dlg-x" onClick={onClose}>×</button>
        </header>

        <div className="pm-add-row">
          <input value={name} autoFocus placeholder={t('exp.addCat')}
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && void add()} />
          <button className="btn primary" disabled={!name.trim()}
                  onClick={() => void add()}>{t('common.add')}</button>
        </div>

        <div className="cat-list">
          {cats.map((c) => (
            <div key={c.id} className="cat-row flat">
              <input className="pm-rename" value={c.name}
                     onChange={(e) => void rename(c.id, e.target.value)} />
              <small>{countOf(c.id)}</small>
              <button className="act danger" onClick={() => del.ask(c)}>
                {t('common.delete')}
              </button>
            </div>
          ))}
        </div>

        <button className="dlg-primary" onClick={onClose}>{t('common.close')}</button>

        {del.target && (
          <ConfirmDialog
            title={t('common.delete')}
            subject={del.target.name}
            amount={`${countOf(del.target.id)} ${t('nav.expenses').toLowerCase()}`}
            message={t('exp.confirmDeleteCat')}
            onConfirm={() => remove(del.target!.id)}
            onClose={del.close}
          />
        )}
      </div>
    </div>
  );
}
