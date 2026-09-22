import { useSettings } from '../store/settings';
import { Icon } from '../lib/icons';
import { exportCsv, exportPdf, type ExportColumn } from '../lib/export';
import { exportXlsx } from '../lib/xlsx';
import './export.css';

/**
 * Boutons d'export, posés à droite du bandeau de résumé.
 *
 * Les deux formats répondent à des besoins distincts : le tableur sert à
 * retravailler les chiffres, le PDF à les transmettre ou les archiver
 * tels quels. Proposer les deux évite au commerçant de convertir à la
 * main.
 */
export default function ExportButtons<T>({
  rows, columns, title, period, summary,
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  title: string;
  period?: string;
  summary?: string;
}) {
  const { t, settings } = useSettings();
  const disabled = rows.length === 0;

  /** Nom de fichier daté, comme pour le CSV. */
  const fileName = (ext: string): string => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
  };

  return (
    <span className="exports">
      {/* Trois formats, trois usages : le classeur pour retravailler
          les chiffres, le CSV pour les reprendre dans un autre outil,
          le PDF pour transmettre ou archiver. */}
      <button className="export-btn" disabled={disabled}
              title={t('export.xlsxHint')}
              onClick={() => exportXlsx(rows, columns, title, fileName('xlsx'))}>
        <Icon name="file" size={14} />
        {t('export.xlsx')}
      </button>

      <button className="export-btn" disabled={disabled}
              title={t('export.excelHint')}
              onClick={() => exportCsv(rows, columns, title)}>
        <Icon name="file" size={14} />
        {t('export.excel')}
      </button>

      <button className="export-btn" disabled={disabled}
              title={t('export.pdfHint')}
              onClick={() => exportPdf(rows, columns, {
                shopName: settings.shopName,
                title,
                period,
                summary,
              })}>
        <Icon name="print" size={14} />
        {t('export.pdf')}
      </button>
    </span>
  );
}
