/**
 * Relais d'impression Gestock.
 *
 * Le navigateur ne peut pas parler à une imprimante sans demander son
 * accord au commerçant à chaque session. Ce petit service, lui, tourne
 * sur le poste et n'a pas cette contrainte : Gestock lui envoie le
 * ticket, il le pousse vers l'imprimante installée dans Windows.
 *
 * Il n'écoute que sur 127.0.0.1 : rien de ce qu'il expose n'est
 * accessible depuis le réseau, même sur un wifi partagé.
 */

import { createServer } from 'node:http';
import { sendRaw, listPrinters, platform } from './printer.js';
import { loadConfig, saveConfig } from './config.js';

const PORT = 9110;
const HOST = '127.0.0.1';

/** Taille maximale d'un ticket. Un reçu dépasse rarement 8 Ko ; au-delà,
 *  c'est une erreur d'appel, et on refuse plutôt que de saturer la file. */
const MAX_BODY = 512 * 1024;

/**
 * Gestock est servi depuis une autre origine (un domaine, ou le serveur
 * de développement). Sans ces en-têtes, le navigateur bloquerait ses
 * appels avant même qu'ils n'arrivent ici.
 */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  cors(res);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Lit le corps de la requête, en refusant ce qui est anormalement gros. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    /* Gestock interroge cette route au démarrage pour savoir s'il peut
       imprimer sans passer par le dialogue du navigateur. */
    if (url.pathname === '/ping') {
      const cfg = await loadConfig();
      return json(res, 200, {
        ok: true,
        service: 'gestock-relay',
        version: 1,
        printer: cfg.printer,
        width: cfg.width,
        // L'application n'explique pas la meme chose selon le systeme :
        // on ne parle pas de « Generic / Text Only » sur un Mac.
        platform,
      });
    }

    if (url.pathname === '/printers') {
      return json(res, 200, { ok: true, printers: await listPrinters() });
    }

    /* Le commerçant choisit son imprimante une fois ; le relais la
       retient et Gestock n'a plus jamais à la redemander. */
    if (url.pathname === '/config' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const cfg = await saveConfig({
        printer: String(body.printer ?? ''),
        width: body.width === 80 ? 80 : 58,
      });
      return json(res, 200, { ok: true, ...cfg });
    }

    if (url.pathname === '/print' && req.method === 'POST') {
      const raw = await readBody(req);
      const cfg = await loadConfig();

      /* L'appel peut imposer une imprimante ; sinon on prend celle que
         le commerçant a réglée. */
      const target = url.searchParams.get('printer') || cfg.printer;
      if (!target) return json(res, 400, { ok: false, error: 'NO_PRINTER_SET' });
      if (raw.length === 0) return json(res, 400, { ok: false, error: 'EMPTY_PAYLOAD' });

      const result = await sendRaw(target, raw);
      return result.ok
        ? json(res, 200, { ok: true, bytes: result.bytes, printer: target })
        : json(res, 502, { ok: false, error: result.error, printer: target });
    }

    return json(res, 404, { ok: false, error: 'UNKNOWN_ROUTE' });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'ERROR';
    return json(res, code === 'BODY_TOO_LARGE' ? 413 : 500, { ok: false, error: code });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Relais Gestock a l ecoute sur http://${HOST}:${PORT}`);
});

/* Si le port est déjà pris, c'est presque toujours qu'un relais tourne
   déjà : on le dit clairement plutôt que d'afficher une trace. */
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Le port ${PORT} est deja utilise : un relais tourne sans doute deja.`);
    process.exit(1);
  }
  throw e;
});
