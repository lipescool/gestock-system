import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import './select.css';

/**
 * Liste déroulante.
 *
 * Un `<select>` natif délègue l'affichage de sa liste au système : elle
 * apparaît en rectangle gris, sans arrondi ni couleur, et ignore le thème
 * sombre. Aucune règle CSS ne peut la corriger. On redessine donc la liste
 * nous-mêmes, pour qu'elle ressemble au reste de l'application.
 *
 * La liste est rendue dans un portail attaché au `body`, pas à côté du
 * bouton : posée dans un dialogue, elle était rognée par les bords de
 * celui-ci et disparaissait dès qu'on faisait défiler.
 */

export interface Option {
  value: string;
  label: string;
  /** Rendu libre à gauche du libellé : icône de catégorie, drapeau… */
  prefix?: React.ReactNode;
  hint?: string;
}

export interface SelectProps {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Au-delà de ce nombre d'options, un champ de recherche apparaît. */
  searchAfter?: number;
}

interface Placement { top: number; left: number; width: number; maxHeight: number }

export default function Select(
  { value, options, onChange, placeholder, disabled, id, searchAfter = 8 }: SelectProps,
) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState<Placement | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  const shown = query.trim() === ''
    ? options
    : options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  const withSearch = options.length > searchAfter;

  /** Calcule où poser la liste, au-dessus ou en dessous du bouton. */
  const measure = () => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;

    setPlace({
      top: up ? 0 : r.bottom + 6,
      left: r.left,
      width: r.width,
      maxHeight: Math.min(320, up ? above : below),
    });

    // Vers le haut, on ancre par le bas pour que la liste grandisse
    // dans la bonne direction.
    if (up) {
      setPlace({
        top: r.top - 6 - Math.min(320, above),
        left: r.left,
        width: r.width,
        maxHeight: Math.min(320, above),
      });
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target)) return;
      if (list.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };

    // Un défilement ailleurs dans la page déplace le bouton : la liste doit
    // le suivre. Elle ne se ferme que si le bouton sort de l'écran.
    const onScroll = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      const r = box.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
      measure();
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', measure);

    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  // L'option survolée au clavier doit rester visible.
  useEffect(() => {
    if (!open || !list.current) return;
    const el = list.current.querySelectorAll('.sel-opt')[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = () => { setOpen(false); setQuery(''); };
  const pick = (v: string) => { onChange(v); close(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) pick(shown[active].value);
    }
  };

  return (
    <div className={`sel ${open ? 'open' : ''} ${disabled ? 'off' : ''}`} ref={box}>
      <button
        type="button"
        id={id}
        className="sel-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && (open ? close() : setOpen(true))}
        onKeyDown={onKey}
      >
        {current?.prefix && <span className="sel-prefix">{current.prefix}</span>}
        <span className={`sel-label ${current ? '' : 'ph'}`}>
          {current?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown size={16} className="sel-arrow" aria-hidden />
      </button>

      {open && place && createPortal(
        <div
          className="sel-list"
          role="listbox"
          ref={list}
          style={{
            top: place.top,
            left: place.left,
            width: place.width,
            maxHeight: place.maxHeight,
          }}
          onKeyDown={onKey}
        >
          {withSearch && (
            <input
              className="sel-search"
              autoFocus
              value={query}
              placeholder="…"
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKey}
            />
          )}

          <div className="sel-scroll">
            {shown.length === 0 && <p className="sel-none">—</p>}
            {shown.map((o, i) => (
              <button
                type="button"
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`sel-opt ${o.value === value ? 'on' : ''} ${i === active ? 'hl' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
              >
                {o.prefix && <span className="sel-prefix">{o.prefix}</span>}
                <span className="sel-opt-label">
                  {o.label}
                  {o.hint && <small>{o.hint}</small>}
                </span>
                {o.value === value && <Check size={15} className="sel-check" aria-hidden />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
