import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, now, EMPTY } from '../db';
import { logAudit } from '../db/audit';
import { useSettings } from '../store/settings';
import { CURRENCIES } from '../i18n/currencies';
import { LANGS } from '../i18n/seed';
import { printer } from '../print/service';
import { relayStatus, relayPrinters, relaySetPrinter, type RelayPrinter } from '../print/transport';
import { downloadBackup, importBackup } from '../lib/backup';
import { Icon, type IconName } from '../lib/icons';
import { PayIcon, PAY_ICONS } from '../lib/payIcons';
import Select from '../components/Select';
import ConfirmDialog, { useConfirm } from '../components/ConfirmDialog';
import LabelSettings from './LabelSettings';
import type { Printer as PrinterRow, User as UserRow } from '../db/schema';
import { hashPin, hashAnswer, clearFailures, findUserByPin } from '../lib/pin';
import { SKINS, type ThemeMode, type Corners } from '../lib/theme';
import { playSound } from '../lib/sound';
import './settings.css';

/** Les quatre chemins vers une imprimante, plus le relais local. */
type PrinterKind = 'relay' | 'bluetooth' | 'usb' | 'network' | 'browser';

type Section = 'general' | 'appearance' | 'payments' | 'printing' | 'labels' | 'security' | 'backup';

export default function Settings() {
  const { t } = useSettings();
  const [section, setSection] = useState<Section>('general');

  const SECTIONS: { key: Section; icon: IconName }[] = [
    { key: 'general', icon: 'settings' },
    { key: 'appearance', icon: 'palette' },
    { key: 'payments', icon: 'card' },
    { key: 'printing', icon: 'print' },
    { key: 'labels', icon: 'tag' },
    { key: 'security', icon: 'lock' },
    { key: 'backup', icon: 'save' },
  ];

  return (
    <div className="page set">
      <header className="page-head">
        <h1>{t('nav.settings')}</h1>
      </header>

      <div className="set-body">
        <nav className="set-nav">
          {SECTIONS.map((s) => (
            <button key={s.key} className={section === s.key ? 'on' : ''}
                    onClick={() => setSection(s.key)}>
              <Icon name={s.icon} size={17} inherit={section === s.key} />
              {t(`set.${s.key}`)}
            </button>
          ))}
        </nav>

        <div className="set-panel">
          {section === 'general' && <General />}
          {section === 'appearance' && <Appearance />}
          {section === 'payments' && <Payments />}
          {section === 'printing' && <Printing />}
          {/* Les étiquettes ont leur propre écran : une étiqueteuse
              n'a pas de largeur de ticket, elle a un format de
              planche et un nombre d'exemplaires. */}
          {section === 'labels' && (
            <LabelSettings Group={Group} Field={Field} Toggle={Toggle} />
          )}
          {section === 'security' && <Security />}
          {section === 'backup' && <BackupPanel />}
        </div>
      </div>
    </div>
  );
}

/* ---- Général ---- */

function General() {
  const { t, settings, set, setLang } = useSettings();
  const [name, setName] = useState(settings.shopName);

  return (
    <>
      <Group title={t('set.general')}>
        <div className="set-grid">
          <Field label={t('set.shopName')} saveKey="shopName">
            <input value={name} onChange={(e) => setName(e.target.value)}
                   onBlur={() => void set('shopName', name.trim() || 'Gestock')} />
          </Field>

          <Field label={t('set.currency')} saveKey="currency">
            <Select
              value={settings.currency}
              onChange={(v) => void set('currency', v)}
              options={CURRENCIES.map((c) => ({
                value: c.code,
                label: `${c.code} — ${c.symbol}`,
                hint: c.name,
              }))}
            />
          </Field>
          <Field label={t('set.language')} saveKey="taxRate">
            <Select
              value={settings.lang}
              onChange={(v) => void setLang(v)}
              options={LANGS.map((l) => ({
                value: l.code,
                label: l.label,
                prefix: <span style={{ fontSize: 17 }}>{l.flag}</span>,
              }))}
            />
          </Field>
        </div>
      </Group>

      {/* La taxe a son propre bloc : perdue parmi les autres champs, on ne
          savait pas qu'elle s'appliquait à chaque vente. */}
      <Group title={t('set.taxes')}>
        <Toggle
          label={t('set.enableTax')}
          hint={t('set.enableTaxHint')}
          checked={settings.taxRate > 0}
          onChange={(v) => void set('taxRate', v ? 18 : 0)}
        saveKey="taxRate"
          />
        {settings.taxRate > 0 && (
          <div className="set-grid">
            <Field label={t('set.taxRate')}>
              <input type="number" min={0} max={100} step={0.5} value={settings.taxRate}
                     onChange={(e) => void set('taxRate',
                       Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
            </Field>
            <Field label={t('set.taxName')} saveKey="taxName">
              <input value={settings.taxName}
                     onChange={(e) => void set('taxName', e.target.value)}
                     placeholder="TVA" />
            </Field>
          </div>
        )}
      </Group>

      <Group title={t('common.display')}>
        <Toggle
          label={t('set.showImages')}
          hint={t('set.showImagesHint')}
          checked={settings.showProductImages}
          onChange={(v) => void set('showProductImages', v)}
        saveKey="showProductImages"
          />
        <Toggle
          label={t('set.sounds')}
          hint={t('set.soundsHint')}
          checked={settings.soundEnabled}
          onChange={(v) => { void set('soundEnabled', v); if (v) playSound('add'); }}
        saveKey="soundEnabled"
          />
      </Group>

      <Group title={t('set.discounts')}>
        <Toggle
          label={t('set.enableDiscount')}
          hint={t('set.enableDiscountHint')}
          checked={settings.discountEnabled}
          onChange={(v) => void set('discountEnabled', v)}
        saveKey="discountEnabled"
          />
        {settings.discountEnabled && (
          <div className="set-grid">
            <Field label={t('set.maxDiscount')} saveKey="maxDiscountPercent">
              <input type="number" min={0} max={100} step={1} value={settings.maxDiscountPercent}
                     onChange={(e) => void set('maxDiscountPercent',
                       Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
            </Field>
          </div>
        )}
      </Group>
    </>
  );
}

/* ---- Moyens de paiement ---- */

function Payments() {
  const { t } = useSettings();
  const methods = useLiveQuery(() => db.paymentMethods.orderBy('position').toArray(), []) ?? EMPTY<never>();
  const [adding, setAdding] = useState(false);

  const [draft, setDraft] = useState({ name: '', icon: 'cash' });
  const [pickFor, setPickFor] = useState<string | null>(null);
  const del = useConfirm<{ id: string; name: string; enabled: boolean }>();

  const toggle = async (id: string, enabled: boolean) => {
    const m = methods.find((x) => x.id === id);
    await db.paymentMethods.update(id, { enabled, updatedAt: now() });
    await logAudit({
      entity: 'paymentMethod', entityId: id, action: 'update',
      after: { name: m?.name ?? '', enabled },
    });
  };

  const rename = async (id: string, name: string) => {
    await db.paymentMethods.update(id, { name, updatedAt: now() });
  };

  const setIcon = async (id: string, icon: string) => {
    await db.paymentMethods.update(id, { icon, updatedAt: now() });
    setPickFor(null);
  };

  const add = async () => {
    if (!draft.name.trim()) return;
    const id = uid();
    await db.paymentMethods.add({
      id, name: draft.name.trim(), icon: draft.icon,
      opensDrawer: false, requiresRef: false, enabled: true,
      position: methods.length, updatedAt: now(),
    });
    await logAudit({ entity: 'paymentMethod', entityId: id, action: 'create', after: draft });
    setDraft({ name: '', icon: 'cash' });
    setAdding(false);
  };

  const remove = async (id: string) => {
    const gone = methods.find((x) => x.id === id);
    await db.paymentMethods.delete(id);
    await logAudit({
      entity: 'paymentMethod', entityId: id, action: 'delete',
      before: gone ? { name: gone.name } : null,
    });
  };

  return (
    <Group title={t('set.payments')}>
      <div className="pm-list">
        {methods.map((m) => (
          <div key={m.id} className={`pm-row ${m.enabled ? 'on' : ''}`}>
            <button className="pm-ico" title={t('cat.icon')}
                    onClick={() => setPickFor(pickFor === m.id ? null : m.id)}>
              <PayIcon id={m.icon} size={19} />
            </button>

            <div className="pm-name">
              <input className="pm-rename" value={m.name}
                     onChange={(e) => void rename(m.id, e.target.value)} />

            </div>

            <button className="switch" role="switch" aria-checked={m.enabled}
                    onClick={() => void toggle(m.id, !m.enabled)}>
              <span />
            </button>
            <button className="act danger" onClick={() => del.ask(m)}>
              {t('common.delete')}
            </button>

            {pickFor === m.id && (
              <div className="pm-picker">
                {PAY_ICONS.map((ic) => (
                  <button key={ic} className={`icon-opt ${m.icon === ic ? 'on' : ''}`}
                          onClick={() => void setIcon(m.id, ic)}>
                    <PayIcon id={ic} size={19} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {adding ? (
        <div className="pm-add">
          <div className="pm-add-icons">
            {PAY_ICONS.map((ic) => (
              <button key={ic} className={`icon-opt ${draft.icon === ic ? 'on' : ''}`}
                      onClick={() => setDraft({ ...draft, icon: ic })}>
                <PayIcon id={ic} size={18} />
              </button>
            ))}
          </div>
          <div className="pm-add-row">
            <input value={draft.name} autoFocus placeholder={t('ob.methodPlaceholder')}
                   onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                   onKeyDown={(e) => e.key === 'Enter' && void add()} />
            <button className="btn primary" onClick={() => void add()}>{t('common.save')}</button>
            <button className="btn ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button className="btn ghost" onClick={() => setAdding(true)}>
          <Icon name="plus" size={15} /> {t('common.add')}
        </button>
      )}

      {del.target && (
        <ConfirmDialog
          title={t('common.delete')}
          subject={del.target.name}
          amount={del.target.enabled ? t('print.active') : t('common.off')}
          message={t('pay.confirmDelete')}
          onConfirm={() => remove(del.target!.id)}
          onClose={del.close}
        />
      )}
    </Group>
  );
}

/* ---- Impression ---- */

/** Imprimantes à tickets. Les étiqueteuses ont leur propre écran. */
function Printing() {
  const { t, settings, set } = useSettings();

  /* Les fiches créées avant que les étiqueteuses existent n'ont pas
     d'usage : elles comptent pour des imprimantes à tickets. */
  const printers = useLiveQuery(
    () => db.printers.filter((p) => (p.usage ?? 'receipt') === 'receipt').toArray(), [],
  ) ?? EMPTY<PrinterRow>();

  const [status, setStatus] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /* Le relais tourne-t-il sur ce poste ? On le demande une fois : c'est
     lui qui decide si l'impression sans dialogue est possible. */
  const [relayOk, setRelayOk] = useState(false);
  const [relayList, setRelayList] = useState<RelayPrinter[]>([]);

  /* Quand le service tourne, le commercant choisit une imprimante, pas
     un mode de liaison : USB, Bluetooth et reseau sont des details que
     le service regle pour lui. Les autres chemins restent accessibles
     pour les postes sans service, derriere ce depliant. */
  const [autreType, setAutreType] = useState(false);

  useEffect(() => {
    let vivant = true;
    relayStatus().then(async (st) => {
      if (!vivant || !st) return;
      setRelayOk(true);
      setDraft((d) => (d.transport === 'browser' ? { ...d, transport: 'relay' } : d));
      try {
        const liste = await relayPrinters();
        if (vivant) setRelayList(liste);
      } catch { /* Le relais repond mais liste mal : sans consequence ici. */ }
    });
    return () => { vivant = false; };
  }, []);
  const delPrinter = useConfirm<PrinterRow>();
  const [draft, setDraft] = useState({
    name: '', transport: 'relay' as PrinterKind,
    width: 58 as 58 | 80, address: '', relay: '',
  });

  const btOk = printer.bluetoothSupported();

  /** Rend cette imprimante active pour toute l'application. */
  const useThis = async (p: PrinterRow) => {
    /* Une seule imprimante active par usage : activer celle des
       tickets ne doit pas désactiver l'étiqueteuse. */
    await db.printers
      .filter((x) => (x.usage ?? 'receipt') === 'receipt')
      .modify({ isDefault: false });
    await db.printers.update(p.id, { isDefault: true, lastUsedAt: now(), updatedAt: now() });
    await set('printTransport', p.transport);
    await set('printWidth', p.width);
    await set('printerAddress', p.address);
    await db.settings.put({ key: 'printRelay', value: p.relay });

    /* Le service garde son propre réglage : sans cette mise à jour, il
       continuerait d'imprimer sur l'imprimante précédente. */
    if (p.transport === 'relay' && p.address) {
      try { await relaySetPrinter(p.address, p.width); } catch { /* sans consequence */ }
    }

    /* Le transport actif est libéré : la prochaine impression rouvre
       celui qu'on vient de choisir, sans attendre un rechargement. */
    await printer.disconnect();
  };

  const test = async (p: PrinterRow) => {
    setBusy(p.id); setStatus(null);
    try {
      await useThis(p);
      await printer.use(p.transport, { address: p.address, relay: p.relay });
      if (!printer.isConnected()) await printer.connect();
      await printer.printTest(settings.shopName, p.width);

      // Le nom de l'appareil retenu par le navigateur est conserve :
      // il evite de redemander « quelle imprimante ? » a chaque test.
      const label = printer.deviceLabel();
      if (label && label !== p.deviceName) {
        await db.printers.update(p.id, { deviceName: label, updatedAt: now() });
      }
      setStatus({ id: p.id, ok: true, msg: t('print.testSent') });
    } catch (e) {
      // Le test dit ce qui a échoué, pas « la vente est enregistrée » :
      // ici aucune vente n'est en jeu, et la cause précise oriente vers
      // la bonne correction.
      const err = e instanceof Error ? e : new Error('ERROR');
      const code = err.name === 'NotFoundError' ? 'NotFoundError' : err.message;

      const msg =
        code === 'BLUETOOTH_UNSUPPORTED' ? t('print.unsupported')
        : code === 'USB_UNSUPPORTED' ? t('print.usbUnsupported')
        : code === 'NotFoundError' ? t('print.noneChosen')
        : code === 'USB_NO_ENDPOINT' ? t('print.usbBusy')
        : err.name === 'SecurityError' ? t('print.usbBusy')
        : err.name === 'NetworkError' ? t('print.usbBusy')
        : code === 'RELAY_PRINTER_OFFLINE' ? t('print.printerOffline')
        : code === 'RELAY_PRINTER_ERROR' ? t('print.printerError')
        : code === 'RELAY_NOT_RUNNING' ? t('print.relayNotRunning')
        : code === 'RELAY_NO_PRINTER' ? t('print.relayNoPrinter')
        : code === 'RELAY_NO_PRINTER_SET' ? t('print.relayNoPrinter')
        : code === 'RELAY_UNREACHABLE' ? t('print.relayDown')
        : code === 'NO_WRITABLE_CHARACTERISTIC' ? t('print.notAPrinter')
        : `${t('print.testFailed')} (${err.name}: ${err.message})`;

      setStatus({ id: p.id, ok: false, msg });
    } finally { setBusy(null); }
  };

  const add = async () => {
    if (!draft.name.trim()) return;
    const id = uid();
    const first = printers.length === 0;
    const row: PrinterRow = {
      id, name: draft.name.trim(), transport: draft.transport, width: draft.width,
      usage: 'receipt',
      deviceId: null, deviceName: null,
      address: draft.address.trim(), relay: draft.relay.trim(),
      isDefault: first, lastUsedAt: null, updatedAt: now(),
    };
    await db.printers.add(row);

    /* Le service retient l'imprimante de son cote : le choix survit
       alors a la fermeture du navigateur, et c'est tout l'interet. */
    if (row.transport === 'relay' && row.address) {
      try { await relaySetPrinter(row.address, row.width); } catch { /* sans consequence */ }
    }

    if (first) await useThis(row);
    await logAudit({ entity: 'printer', entityId: id, action: 'create',
                     after: { name: row.name } });
    setDraft({ name: '', transport: relayOk ? 'relay' : 'browser', width: 58, address: '', relay: '' });
    setAdding(false);
  };

  const remove = async (p: PrinterRow) => {
    await db.printers.delete(p.id);
    await logAudit({ entity: 'printer', entityId: p.id, action: 'delete',
                     after: { name: p.name } });
  };

  return (
    <>
      <Group title={t('print.printers')}>
        {printers.length === 0 && <p className="hint">{t('print.noPrinter')}</p>}

        <div className="prn-list">
          {printers.map((p) => (
            <div key={p.id} className={`prn-row ${p.isDefault ? 'on' : ''}`}>
              <span className="prn-ico">
                <Icon name={p.transport === 'bluetooth' ? 'bluetooth'
                          : p.transport === 'network' ? 'wifi' : 'print'} size={19} />
              </span>

              <div className="prn-body">
                <b>{p.name}</b>
                <small>
                  {p.transport === 'relay'
                    ? (p.address || t('print.relay'))
                    : t(`print.${p.transport}`)} · {p.width} mm
                  {p.deviceName ? ` · ${p.deviceName}` : ''}
                  {p.address ? ` · ${p.address}` : ''}
                </small>
                {status?.id === p.id && (
                  <em className={status.ok ? 'prn-ok' : 'prn-ko'}>{status.msg}</em>
                )}
              </div>

              <div className="prn-acts">
                {p.isDefault
                  ? <span className="pill ok">{t('print.active')}</span>
                  : <button className="act" onClick={() => void useThis(p)}>
                      {t('print.activate')}
                    </button>}
                <button className="act primary" disabled={busy === p.id}
                        onClick={() => void test(p)}>
                  {busy === p.id ? t('common.loading') : t('print.test')}
                </button>
                <button className="act danger" onClick={() => delPrinter.ask(p)}>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="prn-add">
            <div className="set-grid">
              <Field label={t('print.printerName')}>
                <input value={draft.name} autoFocus placeholder={t('print.namePlaceholder')}
                       onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              {(!relayOk || autreType) && (
                <Field label={t('print.transport')}>
                  <Select
                    value={draft.transport}
                    onChange={(v) => setDraft({ ...draft,
                      transport: v as PrinterKind })}
                    options={[
                      ...(relayOk ? [{ value: 'relay', label: t('print.relay') }] : []),
                      ...(btOk ? [{ value: 'bluetooth', label: t('print.bluetooth') }] : []),
                      { value: 'network', label: t('print.network') },
                      { value: 'browser', label: t('print.browser') },
                    ]}
                  />
                </Field>
              )}
              <Field label={t('print.paperWidth')}>
                <Select
                  value={String(draft.width)}
                  onChange={(v) => setDraft({ ...draft, width: Number(v) as 58 | 80 })}
                  options={[
                    { value: '58', label: '58 mm' },
                    { value: '80', label: '80 mm' },
                  ]}
                />
              </Field>
            </div>

            {draft.transport === 'relay' && (
              <div className="set-grid">
                <Field label={t('print.whichPrinter')}>
                  <Select
                    value={draft.address}
                    onChange={(v) => setDraft({
                      ...draft, address: v,
                      name: draft.name.trim() ? draft.name : v,
                    })}
                    options={relayList.map((r) => ({
                      value: r.name,
                      // Les imprimantes qui ne savent pas imprimer de
                      // tickets restent visibles, mais signalees : le
                      // commercant voit pourquoi elles ne conviennent pas.
                      label: r.raw ? r.name : `${r.name} — ${t('print.notRaw')}`,
                    }))}
                  />
                </Field>
              </div>
            )}

            {/* Le Bluetooth du navigateur impose de redesigner
                l'imprimante a chaque session : la norme l'exige, et
                rien dans l'application ne peut l'eviter. Le dire ici
                vaut mieux que de laisser le commercant le decouvrir
                vente apres vente. */}
            {draft.transport === 'bluetooth' && relayOk && (
              <p className="hint">{t('print.btWarn')}</p>
            )}

            {relayOk && !autreType && (
              <button type="button" className="prn-other"
                      onClick={() => { setAutreType(true); }}>
                {t('print.otherKind')}
              </button>
            )}

            {draft.transport === 'network' && (
              <div className="set-grid">
                <Field label={t('set.printerAddress')}>
                  <input placeholder="192.168.1.50:9100" value={draft.address}
                         onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                </Field>

              </div>
            )}

            <div className="btn-row">
              <button className="btn primary" disabled={!draft.name.trim()}
                      onClick={() => void add()}>{t('common.save')}</button>
              <button className="btn ghost" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> {t('print.addPrinter')}
          </button>
        )}

        {!btOk && <p className="hint warn">{t('print.unsupported')}</p>}

        {delPrinter.target && (
          <ConfirmDialog
            title={t('common.delete')}
            subject={delPrinter.target.name}
            amount={`${t(`print.${delPrinter.target.transport}`)} · ${delPrinter.target.width} mm`}
            message={t('print.confirmDelete')}
            onConfirm={() => remove(delPrinter.target!)}
            onClose={delPrinter.close}
          />
        )}
      </Group>

      <Group title={t('set.receipt')}>
        <Field label={t('set.footerLabel')} saveKey="receiptFooter">
          <input value={settings.receiptFooter}
                 onChange={(e) => void set('receiptFooter', e.target.value)}
                 placeholder={t('set.footerHint')} />
        </Field>
      </Group>
    </>
  );
}

/* ---- Apparence ---- */

/**
 * Habillage de l'application.
 *
 * Trois choix séparés plutôt qu'une liste de thèmes tout faits : le
 * commerçant qui aime l'ocre ne veut pas forcément des angles droits,
 * et les combiner lui-même donne bien plus de possibilités que six
 * propositions figées.
 */
function Appearance() {
  const { t, settings, set } = useSettings();

  const MODES: { id: ThemeMode; cle: string }[] = [
    { id: 'auto', cle: 'theme.auto' },
    { id: 'light', cle: 'theme.light' },
    { id: 'dark', cle: 'theme.dark' },
  ];

  const ANGLES: { id: Corners; cle: string }[] = [
    { id: 'square', cle: 'theme.square' },
    { id: 'normal', cle: 'theme.normal' },
    { id: 'round', cle: 'theme.round' },
  ];

  return (
    <>
      <Group title={t('theme.palette')}>
        <p className="hint">{t('theme.paletteHint')}</p>

        <div className="skin-grid">
          {SKINS.map((s) => (
            <button key={s.id}
                    className={`skin ${settings.skin === s.id ? 'on' : ''}`}
                    onClick={() => void set('skin', s.id)}>
              {/* L'aperçu montre la couleur appliquée : un nom seul ne
                  dit rien de ce qu'on va obtenir. */}
              <span className="skin-dot" style={{ background: s.couleur }} />
              <b>{t(`skin.${s.id}`)}</b>
              {settings.skin === s.id && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      </Group>

      <Group title={t('theme.mode')}>
        <p className="hint">{t('theme.modeHint')}</p>
        <div className="seg">
          {MODES.map((m) => (
            <button key={m.id} className={settings.themeMode === m.id ? 'on' : ''}
                    onClick={() => void set('themeMode', m.id)}>
              {t(m.cle)}
            </button>
          ))}
        </div>
      </Group>

      <Group title={t('theme.corners')}>
        <p className="hint">{t('theme.cornersHint')}</p>
        <div className="seg">
          {ANGLES.map((a) => (
            <button key={a.id} className={settings.corners === a.id ? 'on' : ''}
                    onClick={() => void set('corners', a.id)}>
              {t(a.cle)}
            </button>
          ))}
        </div>
      </Group>
    </>
  );
}

/* ---- Securite ---- */

/**
 * Fenêtre qui exige le code avant un geste lourd.
 *
 * Le code se demande au moment où il sert, pas dans un champ laissé
 * en permanence dans le formulaire : on voit alors pourquoi on le
 * saisit, et l'avertissement est sous les yeux.
 */
function PinPrompt({ title, message, confirmLabel, onConfirm, onClose }: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: (code: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const [code, setCode] = useState('');
  const [faux, setFaux] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const valider = async () => {
    if (code.length !== 5 || occupe) return;
    setOccupe(true);
    const ok = await onConfirm(code);
    setOccupe(false);
    if (ok) { onClose(); return; }
    setFaux(true);
    setCode('');
    setTimeout(() => setFaux(false), 2000);
  };

  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div className="dlg pin-dlg" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="dlg-note">{message}</p>

        <PinField label={t('sec.currentPin')} value={code} onChange={setCode} />
        {faux && <p className="field-err">{t('sec.wrongOldPin')}</p>}

        <div className="dlg-actions">
          <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn danger" onClick={() => void valider()}
                  disabled={code.length !== 5 || occupe}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Saisie d'un code, masquée par défaut.
 *
 * L'œil sert surtout quand on définit un nouveau code : composer cinq
 * chiffres à l'aveugle et devoir les retaper à l'identique fait rater
 * l'opération sans qu'on sache pourquoi.
 */
function PinField({ label, value, onChange }:
{ label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useSettings();
  const [visible, setVisible] = useState(false);

  return (
    <Field label={label}>
      <div className="pin-input">
        <input type={visible ? 'text' : 'password'}
               inputMode="numeric" maxLength={5}
               autoComplete="off"
               value={value}
               onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
        <button type="button" className="pin-eye"
                onClick={() => setVisible((v) => !v)}
                title={visible ? t('sec.hidePin') : t('sec.showPin')}
                aria-label={visible ? t('sec.hidePin') : t('sec.showPin')}>
          <Icon name={visible ? 'eyeOff' : 'eye'} size={17} />
        </button>
      </div>
    </Field>
  );
}

/**
 * Code d'accès de la caisse.
 *
 * L'interrupteur commande la protection ; le code lui-même se change
 * en dessous. Couper la protection efface le code : le garder en base
 * sans qu'il serve n'apporterait rien, et le commerçant s'attend à ce
 * que « désactivé » veuille dire « effacé ».
 */
function Security() {
  const { t } = useSettings();
  const [offDialog, setOffDialog] = useState(false);

  /* L'ancien code est exigé dès qu'il en existe un : sans cela, qui
     passe devant une caisse laissée ouverte peut changer la
     combinaison et en verrouiller le propriétaire. */
  const [ancien, setAncien] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');

  /* Question de secours : sans elle, un code oublié enferme le
     commerçant hors de sa propre caisse, sans recours. */
  const [question, setQuestion] = useState('');
  const [reponse, setReponse] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);

  const users = useLiveQuery(
    () => db.users.filter((u) => u.active).toArray(), []) ?? EMPTY<UserRow>();
  const proprietaire = users.find((u) => u.role === 'owner') ?? users[0] ?? null;
  const protege = users.some((u) => u.pinHash);

  /* La question déjà enregistrée s'affiche : le commerçant doit
     pouvoir la relire avant de décider s'il la change. */
  const questionEnBase = users.find((u) => u.recoveryQuestion)?.recoveryQuestion ?? '';
  useEffect(() => { setQuestion(questionEnBase); }, [questionEnBase]);

  const dire = (ok: boolean, texte: string) => {
    setMsg({ ok, texte });
    setTimeout(() => setMsg(null), 4000);
  };

  const definir = async () => {
    if (!proprietaire) return;
    if (protege && !(await findUserByPin(ancien))) {
      return dire(false, t('sec.wrongOldPin'));
    }
    if (pin.length !== 5) return dire(false, t('sec.pinLength'));
    if (pin !== pin2) return dire(false, t('sec.pinMismatch'));
    if (!protege && (!question.trim() || !reponse.trim())) {
      return dire(false, t('sec.recoveryRequired'));
    }

    await db.users.update(proprietaire.id, {
      pinHash: await hashPin(pin),
      // À la première activation seulement : changer de code ne doit
      // pas effacer une question déjà en place.
      ...(question.trim() && reponse.trim()
        ? { recoveryQuestion: question.trim(), recoveryHash: await hashAnswer(reponse) }
        : {}),
      updatedAt: now(),
    });
    clearFailures();
    setAncien(''); setPin(''); setPin2(''); setReponse('');
    await logAudit({ entity: 'user', entityId: proprietaire.id, action: 'update',
                     after: { pin: 'set' } });
    dire(true, protege ? t('sec.pinChanged') : t('sec.pinSet'));
  };

  const desactiver = async (codeSaisi: string) => {
    /* Le code disparaît de tous les comptes, pas seulement du
       propriétaire : un code oublié sur un compte de caissier
       continuerait de verrouiller l'application. */
    if (!(await findUserByPin(codeSaisi))) return false;
    for (const u of users.filter((x) => x.pinHash)) {
      await db.users.update(u.id, { pinHash: null, updatedAt: now() });
    }
    clearFailures();
    await logAudit({ entity: 'user', entityId: proprietaire?.id ?? 'all',
                     action: 'update', after: { pin: 'cleared' } });
    dire(true, t('sec.pinRemoved'));
    return true;
  };

  return (
    <>
      <Group title={t('sec.access')}>
        <Toggle
          label={t('sec.lockEnabled')}
          hint={t('sec.lockHint')}
          checked={protege}
          onChange={(v) => {
            // Activer se fait en choisissant un code, pas d'un geste :
            // l'interrupteur seul laisserait la caisse verrouillée
            // sans que personne connaisse la combinaison.
            // Couper la protection ouvre une fenêtre qui demande le
            // code : le geste est lourd, il mérite d'être confirmé là
            // où on le déclenche plutôt que dans un champ à part.
            if (!v) setOffDialog(true);
            else dire(false, t('sec.setPinFirst'));
          }}
        />

        {protege && (
          <div className="set-grid">
            <PinField label={t('sec.currentPin')} value={ancien} onChange={setAncien} />
          </div>
        )}

        <div className="set-grid">
          <PinField label={protege ? t('sec.newPin') : t('sec.choosePin')}
                    value={pin} onChange={setPin} />
          <PinField label={t('sec.confirmPin')} value={pin2} onChange={setPin2} />
        </div>

        {/* La question de secours n'est demandée qu'à l'activation.
            Elle se modifie ensuite par le même formulaire. */}
        <div className="set-grid">
          <Field label={t('sec.question')} hint={t('sec.questionHint')}>
            <input value={question} maxLength={80}
                   placeholder={t('sec.questionPlaceholder')}
                   onChange={(e) => setQuestion(e.target.value)} />
          </Field>
          <Field label={t('sec.answer')}>
            <input value={reponse} maxLength={60}
                   onChange={(e) => setReponse(e.target.value)} />
          </Field>
        </div>

        <button className="btn" onClick={() => void definir()}
                disabled={pin.length !== 5 || pin2.length !== 5
                          || (protege && ancien.length !== 5)}>
          {protege ? t('sec.changePin') : t('sec.enableLock')}
        </button>

        {msg && <p className={msg.ok ? 'set-ok' : 'field-err'}>{msg.texte}</p>}
      </Group>

      {offDialog && (
        <PinPrompt
          title={t('sec.disableTitle')}
          message={t('sec.disableWarn')}
          confirmLabel={t('sec.disable')}
          onConfirm={desactiver}
          onClose={() => setOffDialog(false)}
        />
      )}
    </>
  );
}

/* ---- Sauvegarde ---- */

function BackupPanel() {
  const { t, settings, set } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const backups = useLiveQuery(
    () => db.backups.orderBy('createdAt').reverse().limit(10).toArray(), []) ?? EMPTY<never>();


  // La restauration remplace la totalité des données : elle mérite la
  // même confirmation qu'une suppression, sinon un fichier ouvert par
  // erreur efface toute la comptabilité.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const restore = async (file: File) => {
    const text = await file.text();
    try {
      const res = await importBackup(text);
      setStatus(`✓ Restauré (${new Date(res.createdAt).toLocaleString()})`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setStatus(`✗ ${e instanceof Error ? e.message : 'ERROR'}`);
    }
  };

  return (
    <>
      <Group title={t('set.autoBackup')}>
        <Toggle
          label={t('set.autoBackup')}
          hint={t('set.autoBackupHint')}
          checked={settings.autoBackupEnabled}
          onChange={(v) => void set('autoBackupEnabled', v)}
        saveKey="autoBackupEnabled"
          />
        {/* Deux listes plutôt qu'un champ d'heure : celui du
            navigateur oblige à viser de petits chiffres et refuse une
            saisie incomplète, ce qui le rend pénible au clavier comme
            au doigt. */}
        <Field label={t('set.backupTime')} saveKey="autoBackupTime">
          <div className="time-pick">
            <Select
              value={settings.autoBackupTime.slice(0, 2)}
              onChange={(h) => void set('autoBackupTime',
                `${h}:${settings.autoBackupTime.slice(3, 5)}`)}
              options={Array.from({ length: 24 }, (_, i) => {
                const v = String(i).padStart(2, '0');
                return { value: v, label: `${v} h` };
              })}
            />
            <Select
              value={settings.autoBackupTime.slice(3, 5)}
              onChange={(m) => void set('autoBackupTime',
                `${settings.autoBackupTime.slice(0, 2)}:${m}`)}
              /* Par quart d'heure : personne ne règle une sauvegarde
                 à 22 h 07, et soixante entrées seraient illisibles.
                 Une minute déjà enregistrée hors de ces quatre choix
                 y est ajoutée, sinon la liste afficherait autre chose
                 que le réglage réel. */
              options={[...new Set(['00', '15', '30', '45',
                                    settings.autoBackupTime.slice(3, 5)])]
                .sort()
                .map((v) => ({ value: v, label: v }))}
            />
          </div>
        </Field>
      </Group>

      <Group title={t('set.backup')}>
        <div className="btn-row">
          <button className="btn primary"
                  onClick={() => void downloadBackup('manual', settings.shopName)}>
            💾 {t('set.backupNow')}
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            ↺ {t('set.restore')}
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden
                 onChange={(e) => e.target.files?.[0] && setPendingFile(e.target.files[0])} />
        </div>
        {status && <p className={`hint ${status.startsWith('✓') ? 'ok' : 'warn'}`}>{status}</p>}
        <p className="hint">{t('set.restoreWarn')}</p>

        {pendingFile && (
          <ConfirmDialog
            title={t('set.restore')}
            subject={pendingFile.name}
            amount={`${(pendingFile.size / 1024).toFixed(0)} Ko`}
            message={t('set.restoreWarn')}
            confirmLabel={t('set.restore')}
            onConfirm={() => restore(pendingFile)}
            onClose={() => setPendingFile(null)}
          />
        )}
      </Group>

      {backups.length > 0 && (
        <Group title={t('set.recentBackups')}>
          <ul className="bk-list">
            {backups.map((b) => (
              <li key={b.id}>
                <span>{new Date(b.createdAt).toLocaleString()}</span>
                {/* « manual » sortait tel quel de la base : c'est une
                    valeur technique, pas un mot à montrer. */}
                <span className={`pill ${b.kind === 'auto' ? 'dim' : 'ok'}`}>
                  {t(b.kind === 'auto' ? 'backup.auto' : 'backup.manual')}
                </span>
                <small>{(b.size / 1024).toFixed(0)} {t('backup.kb')}</small>
              </li>
            ))}
          </ul>
        </Group>
      )}
    </>
  );
}

/* ---- Éléments partagés ---- */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="set-group card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children, saveKey }:
{ label: string; hint?: string; children: React.ReactNode; saveKey?: string }) {
  const { t } = useSettings();
  const saved = useSaved(saveKey);

  return (
    <label className="set-field">
      <span>
        {label}
        {/* Les réglages s'écrivent au fil de la frappe, sans bouton :
            sans ce signe, rien ne disait au commerçant si sa saisie
            avait été prise en compte. */}
        {saved && <em className="field-saved">{t('common.saved')}</em>}
      </span>
      {children}
      {/* L'indication se place sous le champ : au-dessus, elle
          éloignerait le libellé de ce qu'il désigne. */}
      {hint && <em className="field-hint">{hint}</em>}
    </label>
  );
}

/**
 * Ce champ vient-il d'être enregistré ?
 *
 * Le signe reste deux secondes : assez pour être vu, assez peu pour
 * ne pas encombrer un écran qu'on parcourt.
 */
function useSaved(key?: string): boolean {
  const savedKey = useSettings((s) => s.savedKey);
  const savedAt = useSettings((s) => s.savedAt);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!key || savedKey !== key) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(id);
  }, [key, savedKey, savedAt]);

  return visible;
}

function Toggle({ label, hint, checked, onChange, saveKey }:
{ label: string; hint?: string; checked: boolean;
  onChange: (v: boolean) => void; saveKey?: string }) {
  const { t } = useSettings();
  const saved = useSaved(saveKey);

  return (
    <div className="set-toggle">
      <div>
        <b>
          {label}
          {saved && <em className="field-saved">{t('common.saved')}</em>}
        </b>
        {hint && <small>{hint}</small>}
      </div>
      <button className="switch" role="switch" aria-checked={checked}
              onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}
