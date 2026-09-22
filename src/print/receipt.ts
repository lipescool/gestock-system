import { EscPosBuilder, type PaperWidth } from './escpos';
import type { Order, PaymentMethod } from '../db/schema';
import { findCurrency, formatMoney } from '../i18n/currencies';

export interface ReceiptContext {
  shopName: string;
  address?: string;
  phone?: string;
  footer?: string;
  currency: string;
  lang: string;
  width: PaperWidth;
  /** Libellés traduits, fournis par l'appelant : rien n'est écrit en dur ici. */
  labels: {
    subtotal: string; taxes: string; discount: string; fee: string;
    total: string; method: string; received: string; change: string;
    items: string; cashier: string;
  };
  cashierName?: string;
  paymentMethod?: PaymentMethod | null;
}

/** Ticket de caisse en ESC/POS, pour les transports Bluetooth et réseau. */
export function buildReceipt(order: Order, ctx: ReceiptContext): Uint8Array {
  const cur = findCurrency(ctx.currency);
  const money = (v: number) => formatMoney(v, cur, ctx.lang);
  const b = new EscPosBuilder(ctx.width);

  b.align('center').bold(true).size(2, 2).line(ctx.shopName).size(1, 1).bold(false);
  if (ctx.address) b.lineClamped(ctx.address);
  if (ctx.phone) b.lineClamped(ctx.phone);
  b.separator('=');

  b.align('left');
  b.line(`${order.ref}`);
  b.line(new Date(order.createdAt).toLocaleString(ctx.lang));
  if (ctx.cashierName) b.line(`${ctx.labels.cashier}: ${ctx.cashierName}`);
  if (order.customerName) b.lineClamped(order.customerName);
  if (order.tableNumber) b.line(`Table ${order.tableNumber}`);
  b.separator();

  for (const l of order.lines) {
    const amount = l.unitPrice * l.qty - l.discount;
    // Le nom seul sur sa ligne : il peut être long, et le tronquer pour
    // faire tenir le montant à côté rend le ticket illisible.
    b.lineClamped(l.name);
    // Puis le détail du calcul, aligné à droite sur le montant.
    b.keyValue(`  ${l.qty} x ${money(l.unitPrice)}`, money(amount));
    if (l.discount > 0) b.keyValue(`  ${ctx.labels.discount}`, `- ${money(l.discount)}`);
  }

  b.separator();
  b.keyValue(ctx.labels.subtotal, money(order.subtotal));
  if (order.discount > 0) b.keyValue(ctx.labels.discount, `- ${money(order.discount)}`);
  if (order.taxAmount > 0) b.keyValue(`${ctx.labels.taxes} ${order.taxRate}%`, money(order.taxAmount));
  if (order.additionalFee > 0) b.keyValue(ctx.labels.fee, money(order.additionalFee));

  b.bold(true).size(1, 2).keyValue(ctx.labels.total, money(order.total)).size(1, 1).bold(false);
  b.separator();

  if (ctx.paymentMethod) b.keyValue(ctx.labels.method, ctx.paymentMethod.name);
  if (order.paidAmount > 0) {
    b.keyValue(ctx.labels.received, money(order.paidAmount));
    if (order.changeAmount > 0) b.keyValue(ctx.labels.change, money(order.changeAmount));
  }

  const count = order.lines.reduce((s, l) => s + l.qty, 0);
  b.line(`${count} ${ctx.labels.items}`);

  b.feed(1).align('center');
  b.barcode(order.ref.replace(/[^A-Za-z0-9]/g, ''), 50);
  if (ctx.footer) b.lineClamped(ctx.footer);

  b.cut();

  return b.build();
}

/**
 * Même ticket, en HTML, pour le transport « imprimante système ».
 * La largeur du papier devient une largeur de page CSS : le dialogue
 * d'impression du navigateur respecte @page.
 */
export function buildReceiptHtml(order: Order, ctx: ReceiptContext): Uint8Array {
  const cur = findCurrency(ctx.currency);
  const money = (v: number) => formatMoney(v, cur, ctx.lang);
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

  const mm = ctx.width;
  const rows = order.lines
    .map((l) => {
      const amount = l.unitPrice * l.qty - l.discount;
      const unit = l.qty > 1 ? `<div class="sub">${money(l.unitPrice)} × ${l.qty}</div>` : '';
      return `<tr><td>${esc(l.name)}${unit}</td><td class="r">${money(amount)}</td></tr>`;
    })
    .join('');

  const line = (label: string, value: string, strong = false) =>
    `<tr class="${strong ? 'strong' : ''}"><td>${esc(label)}</td><td class="r">${value}</td></tr>`;

  const html = `<!doctype html>
<html lang="${ctx.lang}"><head><meta charset="utf-8">
<style>
  /* La police doit être déclarée ici : l'iframe d'impression est un
     document séparé, il n'hérite pas des @font-face de l'application. */
  @font-face { font-family:'Outfit'; src:url('${location.origin}/fonts/Outfit-Regular.ttf') format('truetype'); font-weight:400 }
  @font-face { font-family:'Outfit'; src:url('${location.origin}/fonts/Outfit-SemiBold.ttf') format('truetype'); font-weight:600 }
  @font-face { font-family:'Outfit'; src:url('${location.origin}/fonts/Outfit-Bold.ttf') format('truetype'); font-weight:700 }
  @font-face { font-family:'Outfit'; src:url('${location.origin}/fonts/Outfit-ExtraBold.ttf') format('truetype'); font-weight:800 }
  @page { size: ${mm}mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; width: ${mm - 6}mm;
    font-family: 'Outfit', ui-monospace, monospace;
    font-size: ${mm === 58 ? 10 : 12}px; line-height: 1.35; color: #000;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: ${mm === 58 ? 16 : 20}px; margin: 0 0 2mm; text-align: center; font-weight: 800; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; }
  .sub { font-size: .85em; opacity: .7; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .4mm 0; vertical-align: top; }
  .strong td { font-weight: 800; font-size: 1.25em; padding-top: 1mm; }
  .meta { font-size: .9em; }
</style></head>
<body>
  <h1>${esc(ctx.shopName)}</h1>
  ${ctx.address ? `<div class="c meta">${esc(ctx.address)}</div>` : ''}
  ${ctx.phone ? `<div class="c meta">${esc(ctx.phone)}</div>` : ''}
  <hr>
  <div class="meta">${esc(order.ref)}</div>
  <div class="meta">${new Date(order.createdAt).toLocaleString(ctx.lang)}</div>
  ${ctx.cashierName ? `<div class="meta">${esc(ctx.labels.cashier)}: ${esc(ctx.cashierName)}</div>` : ''}
  ${order.customerName ? `<div class="meta">${esc(order.customerName)}</div>` : ''}
  <hr>
  <table>${rows}</table>
  <hr>
  <table>
    ${line(ctx.labels.subtotal, money(order.subtotal))}
    ${order.discount > 0 ? line(ctx.labels.discount, `- ${money(order.discount)}`) : ''}
    ${order.taxAmount > 0 ? line(`${ctx.labels.taxes} ${order.taxRate}%`, money(order.taxAmount)) : ''}
    ${order.additionalFee > 0 ? line(ctx.labels.fee, money(order.additionalFee)) : ''}
    ${line(ctx.labels.total, money(order.total), true)}
    ${ctx.paymentMethod ? line(ctx.labels.method, esc(ctx.paymentMethod.name)) : ''}
    ${order.paidAmount > 0 ? line(ctx.labels.received, money(order.paidAmount)) : ''}
    ${order.changeAmount > 0 ? line(ctx.labels.change, money(order.changeAmount)) : ''}
  </table>
  <hr>
  ${ctx.footer ? `<div class="c meta">${esc(ctx.footer)}</div>` : ''}
</body></html>`;

  return new TextEncoder().encode(html);
}
