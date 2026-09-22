import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, now, EMPTY } from '../db';
import { logAudit } from '../db/audit';
import { useSettings } from '../store/settings';
import { printer } from '../print/service';
import { relayStatus, relayPrinters, relaySetPrinter, type RelayPrinter } from '../print/transport';
import { SHEET_FORMATS } from '../lib/barcode';
import { reconnaitreLangage, REGLAGES_PAR_DEFAUT } from '../print/tspl';
import { Icon } from '../lib/icons';
import Select from '../components/Select';
import ConfirmDialog, { useConfirm } from '../components/ConfirmDialog';
import type { Printer as PrinterRow } from '../db/schema';

/** Les liaisons possibles pour une étiqueteuse. */
type Liaison = 'relay' | 'bluetooth' | 'browser';

/**
 * Réglages des étiquettes de produits.
 *
 * Écrit à part de la section des tickets, et non emprunté : les deux
 * n'ont pas les mêmes besoins. Une étiqueteuse n'a pas de « largeur de
 * ticket » — elle a un format d'étiquette, qui va de la vignette
 * 58 × 40 à la planche A4 de quarante étiquettes. Et le nombre
 * d'exemplaires par produit n'a aucun sens pour un reçu.
 */
export default function LabelSettings({
  Group, Field, Toggle,
}: {
  Group: (p: { title: string; children: React.ReactNode }) => React.ReactElement;
  Field: (p: { label: string; hint?: string; saveKey?: string;
               children: React.ReactNode }) => React.ReactElement;
  Toggle: (p: { label: string; hint?: string; checked: boolean;
                onChange: (v: boolean) => void; saveKey?: string }) => React.ReactElement;
}) {
  const { t, settings, set } = useSettings();

  const printers = useLiveQuery(
    () => db.printers.filter((p) => p.usage === 'label').toArray(), [],
  ) ?? EMPTY<PrinterRow>();

  const [status, setStatus] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /* Quelle fiche on modifie, ou `null` pour une création. Sans cela,
     corriger un format demandait de supprimer puis recréer. */
  const [editing, setEditing] = useState<string | null>(null);
  const del = useConfirm<PrinterRow>();

  const [relayOk, setRelayOk] = useState(false);
  const [relayList, setRelayList] = useState<RelayPrinter[]>([]);

  useEffect(() => {
    let vivant = true;
    void relayStatus().then(async (st) => {
      if (!vivant || !st) return;
      setRelayOk(true);
      try {
        const liste = await relayPrinters();
        if (vivant) setRelayList(liste);
      } catch { /* sans conséquence : la liste reste vide */ }
    });
    return () => { vivant = false; };
  }, []);

  const [draft, setDraft] = useState({
    name: '', liaison: 'relay' as Liaison,
    format: '58x40', copies: 1, address: '',
  });

  /** Le format d'une fiche, ou celui par défaut. */
  const fmtDe = (p: PrinterRow) =>
    SHEET_FORMATS[p.labelFormat ?? '58x40'] ?? SHEET_FORMATS['58x40'];

  /** Ce qu'un format donne concrètement, en clair. */
  const decrire = (cle: string): string => {
    const f = SHEET_FORMATS[cle] ?? SHEET_FORMATS['58x40'];
    const n = f.grid.cols * f.grid.rows;
    const taille = cle === 'A4' ? 'A4' : `${f.paper.w} × ${f.paper.h} mm`;
    return `${taille} — ${n} ${n > 1 ? t('lbl.perSheetMany') : t('lbl.perSheetOne')}`;
  };

  /**
   * Rend cette étiqueteuse active.
   *
   * Ses réglages deviennent ceux de l'application : le format et le
   * nombre d'exemplaires appartiennent à la machine, pas à
   * l'application. Changer d'étiqueteuse change donc tout ensemble.
   */
  const activer = async (p: PrinterRow) => {
    await db.printers.filter((x) => x.usage === 'label').modify({ isDefault: false });
    await db.printers.update(p.id, { isDefault: true, lastUsedAt: now(), updatedAt: now() });

    await set('labelPrinter', p.id);
    await set('labelFormat', p.labelFormat ?? '58x40');
    await set('labelCopies', p.labelCopies ?? 1);
    await printer.disconnect();
  };

  const essayer = async (p: PrinterRow) => {
    setBusy(p.id);
    setStatus(null);
    try {
      await activer(p);
      await printer.use(p.transport, { address: p.address, relay: p.relay });
      if (!printer.isConnected()) await printer.connect();
      await printer.printLabelTest('', p.width, p.langage ?? 'escpos', {
        ...REGLAGES_PAR_DEFAUT,
        largeurMm: fmtDe(p).paper.w,
        hauteurMm: fmtDe(p).paper.h,
        colonnes: fmtDe(p).grid.cols,
        rangees: fmtDe(p).grid.rows,
        // Un rouleau étroit est continu ; au-delà, les vignettes sont
        // pré-découpées avec deux millimètres entre elles.
        gapMm: fmtDe(p).paper.w <= 60 ? 0 : 2,
      });
      setStatus({ id: p.id, ok: true, msg: t('lbl.testSent') });
    } catch (e) {
      const err = e instanceof Error ? e : new Error('ERROR');
      const code = err.name === 'NotFoundError' ? 'NotFoundError' : err.message;
      setStatus({
        id: p.id,
        ok: false,
        msg: code === 'BLUETOOTH_UNSUPPORTED' ? t('print.unsupported')
           : code === 'NotFoundError' ? t('print.noneChosen')
           : code === 'RELAY_PRINTER_OFFLINE' ? t('print.printerOffline')
           : code === 'RELAY_PRINTER_ERROR' ? t('print.printerError')
           : code === 'RELAY_NOT_RUNNING' ? t('print.relayNotRunning')
           : `${t('print.testFailed')} (${err.name}: ${err.message})`,
      });
    } finally {
      setBusy(null);
    }
  };

  /** Ouvre le formulaire sur une fiche existante. */
  const modifier = (p: PrinterRow) => {
    setDraft({
      name: p.name,
      liaison: p.transport as Liaison,
      format: p.labelFormat ?? '58x40',
      copies: p.labelCopies ?? 1,
      address: p.address,
    });
    setEditing(p.id);
    setAdding(true);
  };

  const ajouter = async () => {
    /* Le nom n'est plus exigé : il se déduit de la machine choisie.
       Ce qui compte, c'est qu'une machine soit désignée. */
    if (draft.liaison === 'relay' && !draft.address) return;

    const fmt = SHEET_FORMATS[draft.format] ?? SHEET_FORMATS['58x40'];
    const largeur: 58 | 80 = fmt.paper.w >= 80 ? 80 : 58;

    /* Modification : on ne touche qu'aux champs du formulaire, et on
       garde ce qui n'y figure pas — la fiche reste active si elle
       l'était. */
    if (editing) {
      await db.printers.update(editing, {
        name: draft.name.trim() || draft.address || t('lbl.defaultName'),
        transport: draft.liaison,
        labelFormat: draft.format,
        labelCopies: draft.copies,
        langage: reconnaitreLangage(draft.address || draft.name),
        width: largeur,
        address: draft.address.trim(),
        updatedAt: now(),
      });

      const maj = await db.printers.get(editing);
      if (maj?.isDefault) await activer(maj);

      await logAudit({
        entity: 'printer', entityId: editing, action: 'update',
        after: { name: draft.name, format: draft.format },
      });

      setDraft({ name: '', liaison: relayOk ? 'relay' : 'browser',
                 format: '58x40', copies: 1, address: '' });
      setEditing(null);
      setAdding(false);
      return;
    }

    const id = uid();
    const premiere = printers.length === 0;

    const row: PrinterRow = {
      id,
      name: draft.name.trim() || draft.address || t('lbl.defaultName'),
      transport: draft.liaison,
      usage: 'label',
      labelFormat: draft.format,
      labelCopies: draft.copies,
      /* Le langage est reconnu au nom de la machine, jamais demandé :
         un commerçant ne sait pas ce qu'est TSPL, et n'a pas à
         l'apprendre. */
      langage: reconnaitreLangage(draft.address || draft.name),
      /* La largeur sert à l'ESC/POS, qui en a besoin pour ses
         colonnes. Elle se déduit du format : le commerçant ne la
         choisit pas, il choisit une taille d'étiquette. */
      width: largeur,
      deviceId: null,
      deviceName: null,
      address: draft.address.trim(),
      relay: '',
      isDefault: premiere,
      lastUsedAt: null,
      updatedAt: now(),
    };

    await db.printers.add(row);

    if (draft.liaison === 'relay' && draft.address) {
      try { await relaySetPrinter(draft.address, row.width); }
      catch { /* sans conséquence : le service garde son réglage */ }
    }
    if (premiere) await activer(row);

    await logAudit({
      entity: 'printer', entityId: id, action: 'create',
      after: { name: row.name, usage: 'label' },
    });

    setDraft({
      name: '', liaison: relayOk ? 'relay' : 'browser',
      format: '58x40', copies: 1, address: '',
    });
    setAdding(false);
  };

  const supprimer = async (p: PrinterRow) => {
    await db.printers.delete(p.id);
    await logAudit({
      entity: 'printer', entityId: p.id, action: 'delete',
      after: { name: p.name },
    });
  };

  const btOk = printer.bluetoothSupported();


  /* Les imprimantes du poste, celles qui savent imprimer un
     code-barres d'abord. Les autres restent proposées : un commerçant
     peut vouloir un essai sur papier ordinaire avant d'acheter un
     rouleau. */
  const duPoste = [
    ...relayList.filter((r) => r.raw).map((r) => ({
      value: r.name, label: r.name,
    })),
    ...relayList.filter((r) => !r.raw).map((r) => ({
      value: r.name, label: `${r.name} — ${t('lbl.notRaw')}`,
    })),
  ];

  return (
    <>
      <Group title={t('lbl.printers')}>
        {printers.length === 0 && <p className="hint">{t('lbl.none')}</p>}

        <div className="prn-list">
          {printers.map((p) => (
            <div key={p.id} className={`prn-row ${p.isDefault ? 'on' : ''}`}>
              <span className="prn-ico">
                <Icon name={p.transport === 'bluetooth' ? 'bluetooth' : 'tag'} size={19} />
              </span>

              <div className="prn-body">
                <b>{p.name}</b>
                <small>
                  {t(`print.${p.transport}`)} · {decrire(p.labelFormat ?? '58x40')}
                  {(p.labelCopies ?? 1) > 1
                    ? ` · ${p.labelCopies} ${t('lbl.perProduct')}`
                    : ''}
                </small>
                {status?.id === p.id && (
                  <em className={status.ok ? 'prn-ok' : 'prn-ko'}>{status.msg}</em>
                )}
              </div>

              <div className="prn-acts">
                {!p.isDefault && (
                  <button className="act" onClick={() => void activer(p)}>
                    {t('print.use')}
                  </button>
                )}
                <button className="act" onClick={() => modifier(p)}>
                  {t('common.edit')}
                </button>
                <button className="act" disabled={busy === p.id}
                        onClick={() => void essayer(p)}>
                  {busy === p.id ? t('common.loading') : t('print.test')}
                </button>
                <button className="act danger" onClick={() => del.ask(p)}>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="prn-add">
            {/* On commence par la machine, pas par un nom à saisir :
                l'application connaît déjà les imprimantes du poste, et
                le nom se remplit tout seul. */}
            <div className="set-grid">
              {/* La liaison se choisit d'abord : c'est elle qui dit
                  où chercher l'imprimante. */}
              <Field label={t('lbl.connection')}>
                <Select
                  value={draft.liaison}
                  onChange={(v) => setDraft({ ...draft, liaison: v as Liaison, address: '' })}
                  options={[
                    ...(relayOk ? [{ value: 'relay', label: t('lbl.byCable') }] : []),
                    ...(btOk ? [{ value: 'bluetooth', label: t('lbl.byBluetooth') }] : []),
                    { value: 'browser', label: t('lbl.byDialog') },
                  ]}
                />
              </Field>

              {/* Puis laquelle, quand la liaison passe par le poste. */}
              {draft.liaison === 'relay' && (
                <Field label={t('lbl.whichPrinter')} hint={t('lbl.whichHint')}>
                  <Select
                    value={draft.address}
                    onChange={(v) => setDraft({
                      ...draft, address: v,
                      name: draft.name.trim() ? draft.name : v,
                    })}
                    options={duPoste}
                  />
                </Field>
              )}

              <Field label={t('lbl.paper')}>
                <Select
                  value={draft.format}
                  onChange={(v) => setDraft({ ...draft, format: v })}
                  options={Object.keys(SHEET_FORMATS).map((cle) => ({
                    value: cle, label: decrire(cle),
                  }))}
                />
              </Field>

              <Field label={t('lbl.copies')} hint={t('lbl.copiesHint')}>
                <input type="number" min={1} max={200} value={draft.copies}
                       onChange={(e) => setDraft({
                         ...draft,
                         copies: Math.max(1, Math.min(200, Number(e.target.value) || 1)),
                       })} />
              </Field>
            </div>

            {/* Le nom est proposé, pas exigé : il sert à s'y
                retrouver quand on a deux étiqueteuses. */}
            <div className="set-grid">
              <Field label={t('lbl.nameOptional')}>
                <input value={draft.name}
                       placeholder={t('lbl.namePlaceholder')}
                       onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
            </div>

            <div className="prn-add-acts">
              <button className="btn ghost"
                      onClick={() => { setAdding(false); setEditing(null); }}>
                {t('common.cancel')}
              </button>
              <button className="btn primary"
                      disabled={draft.liaison === 'relay' && !draft.address}
                      onClick={() => void ajouter()}>
                {editing ? t('common.save') : t('common.add')}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> {t('lbl.addPrinter')}
          </button>
        )}

        {del.target && (
          <ConfirmDialog
            title={t('common.delete')}
            subject={del.target.name}
            message={t('print.confirmDelete')}
            onConfirm={() => void supprimer(del.target!)}
            onClose={del.close}
          />
        )}
      </Group>

      <Group title={t('lbl.content')}>
        <p className="hint">{t('lbl.contentHint')}</p>

        <Toggle
          label={t('lbl.showName')}
          hint={t('lbl.showNameHint')}
          checked={settings.labelShowName}
          onChange={(v) => void set('labelShowName', v)}
          saveKey="labelShowName"
        />
        <Toggle
          label={t('lbl.showPrice')}
          hint={t('lbl.showPriceHint')}
          checked={settings.labelShowPrice}
          onChange={(v) => void set('labelShowPrice', v)}
          saveKey="labelShowPrice"
        />
      </Group>
    </>
  );
}
