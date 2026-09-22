#!/usr/bin/env node
/*
 * Relais d'impression Gestock.
 *
 * Un navigateur ne peut pas ouvrir une connexion TCP brute : il ne parle que
 * HTTP. Les imprimantes réseau, elles, n'écoutent que du TCP sur le port 9100.
 * Ce programme fait le pont entre les deux, sur le réseau local uniquement.
 *
 * Aucune connexion internet n'est utilisée ni requise.
 *
 * Lancement :   node relay.js [port]
 * Par défaut :  port 7777
 */

const http = require('node:http');
const net = require('node:net');

const PORT = Number(process.argv[2]) || 7777;
const CONNECT_TIMEOUT = 5000;

/** Envoie des octets bruts à une imprimante en TCP. */
function sendToPrinter(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    socket.setTimeout(CONNECT_TIMEOUT);
    socket.once('timeout', () => fail(new Error('TIMEOUT')));
    socket.once('error', fail);

    socket.connect(port, host, () => {
      socket.write(data, () => {
        // Un court délai avant la fermeture : plusieurs modèles tronquent
        // l'impression si le socket se ferme au moment de l'écriture.
        setTimeout(() => {
          socket.end();
          if (!settled) { settled = true; resolve(); }
        }, 150);
      });
    });
  });
}

function parseTarget(raw) {
  const [host, port] = String(raw || '').split(':');
  if (!host) throw new Error('MISSING_TARGET');
  return { host, port: Number(port) || 9100 };
}

const server = http.createServer(async (req, res) => {
  // L'application tourne sur une autre origine (fichier local, autre poste) :
  // sans ces en-têtes, le navigateur refuse la requête.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/ping') {
    try {
      const { host, port } = parseTarget(url.searchParams.get('target'));
      await new Promise((resolve, reject) => {
        const s = new net.Socket();
        s.setTimeout(CONNECT_TIMEOUT);
        s.once('timeout', () => { s.destroy(); reject(new Error('TIMEOUT')); });
        s.once('error', reject);
        s.connect(port, host, () => { s.end(); resolve(); });
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, target: `${host}:${port}` }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (url.pathname === '/print' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const { host, port } = parseTarget(url.searchParams.get('target'));
        const payload = Buffer.concat(chunks);
        if (payload.length === 0) throw new Error('EMPTY_PAYLOAD');

        await sendToPrinter(host, port, payload);
        console.log(`[${new Date().toLocaleTimeString()}] ${payload.length} o → ${host}:${port}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, bytes: payload.length }));
      } catch (e) {
        console.error(`[erreur] ${e.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
});

server.listen(PORT, () => {
  console.log(`Relais d'impression Gestock — port ${PORT}`);
  console.log('');
  for (const [name, addrs] of Object.entries(require('node:os').networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  Adresse à saisir dans Gestock :  ${a.address}:${PORT}   (${name})`);
      }
    }
  }
  console.log('');
  console.log('Laissez cette fenêtre ouverte pendant le service.');
});
