import { useState } from 'react';
import { useT } from '../store/settings';
import { rangeOf, type Period, type Range } from '../lib/reports';
import './period.css';

export interface PeriodValue {
  period: Period;
  range: Range;
}

/** Valeur de départ, pour initialiser un état. */
export const initialPeriod = (period: Period = 'today'): PeriodValue => ({
  period,
  range: rangeOf(period),
});

/**
 * Filtre de période, partagé par tous les écrans qui en ont besoin.
 * « Personnalisé » ouvre deux champs de date : sans lui, on ne peut pas
 * sortir les chiffres d'un mois passé ou d'une semaine précise.
 */
export default function PeriodFilter(
  { value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void },
) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const [from, setFrom] = useState(toDate(value.range.from));
  const [to, setTo] = useState(toDate(value.range.to));

  const pick = (period: Period) => {
    if (period === 'custom') { setOpen(true); return; }
    setOpen(false);
    onChange({ period, range: rangeOf(period) });
  };

  const applyCustom = () => {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

    // Deux bornes inversées donneraient un intervalle vide : on les remet
    // dans l'ordre plutôt que d'afficher zéro sans explication.
    const range = start <= end
      ? { from: start.getTime(), to: end.getTime() }
      : { from: end.getTime(), to: start.getTime() };

    onChange({ period: 'custom', range });
    setOpen(false);
  };

  const PERIODS: Period[] = [
    'today', 'yesterday', 'week', 'lastWeek', 'month', 'year', 'custom',
  ];

  return (
    <div className="pf">
      <div className="pf-tabs">
        {PERIODS.map((p) => (
          <button key={p} className={`pf-tab ${value.period === p ? 'on' : ''}`}
                  onClick={() => pick(p)}>
            {t(`period.${p}`)}
          </button>
        ))}
      </div>

      {value.period === 'custom' && !open && (
        <button className="pf-current" onClick={() => setOpen(true)}>
          {new Date(value.range.from).toLocaleDateString()} →{' '}
          {new Date(value.range.to).toLocaleDateString()}
        </button>
      )}

      {open && (
        <div className="pf-panel">
          <label>
            <span>{t('common.from')}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span>{t('common.to')}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="pf-apply" onClick={applyCustom}>{t('common.apply')}</button>
          <button className="pf-cancel" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
        </div>
      )}
    </div>
  );
}
