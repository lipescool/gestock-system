import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../store/settings';
import './dialog.css';

/**
 * Demande de confirmation avant une action irréversible.
 *
 * Une suppression qui part au premier clic finit toujours par emporter
 * quelque chose qu'on voulait garder. Tout ce qui efface des données
 * passe par ici.
 */
export default function ConfirmDialog({
  title, subject, amount, message, confirmLabel, danger = true, onConfirm, onClose,
}: {
  title: string;
  /** Ce sur quoi porte l'action : nom du produit, libellé de la dépense… */
  subject?: string;
  /** Montant ou quantité associée, affiché à part du libellé. */
  amount?: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Rendu dans un portail, à la racine du document.
   *
   * Placé là où il est écrit dans le JSX, le dialogue héritait des
   * styles de son parent : glissé dans un bloc de réglages, il prenait
   * le vert et la forme arrondie de l'interrupteur voisin. Un portail
   * le sort de cette hiérarchie et lui rend son apparence propre.
   */
  return createPortal(
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg dlg-confirm" onClick={(e) => e.stopPropagation()}>
        <header className="dlg-head">
          <h2>{title}</h2>
          <button className="dlg-x" onClick={onClose}>×</button>
        </header>

        {/* Même présentation que la suppression d'un produit : le nom
            sur un bandeau clair, l'explication en dessous. */}
        {subject && (
          <p className="dlg-note">
            {subject}
            {amount && <small>{amount}</small>}
          </p>
        )}
        {message && <p className="hint">{message}</p>}

        <div className="dlg-actions">
          <button className="dlg-ghost" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className={danger ? 'dlg-danger' : 'dlg-primary'}
                  disabled={busy} onClick={() => void go()} autoFocus>
            {busy ? t('common.loading') : (confirmLabel ?? t('common.delete'))}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Gère l'ouverture d'une confirmation pour un élément donné.
 *
 * Évite de répéter un couple d'états dans chaque écran : on stocke ce qui
 * est visé, et `null` ferme la fenêtre.
 */
export function useConfirm<T>() {
  const [target, setTarget] = useState<T | null>(null);
  return {
    target,
    ask: (item: T) => setTarget(item),
    close: () => setTarget(null),
  };
}
