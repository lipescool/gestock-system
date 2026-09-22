<?php
/**
 * Tableau des licences Gestock.
 *
 * Page privée : elle montre vos clés et vos clients, elle est donc
 * protégée par un mot de passe. Changez-le ci-dessous avant de
 * déposer le fichier.
 */

declare(strict_types=1);

require __DIR__ . '/config.php';

/* ------------------------------------------------------------------ *
   Mot de passe d'accès à cette page.

   Il est aujourd'hui le même que celui de la base : si quelqu'un le
   devine, il a les deux. Mettez-en un différent dès que possible —
   il suffit de changer cette ligne.
 * ------------------------------------------------------------------ */
const MOT_DE_PASSE = 'a_remplir';

session_start();

/* --- Entrée --- */
if (isset($_POST['mdp'])) {
    if (hash_equals(MOT_DE_PASSE, (string)$_POST['mdp'])) {
        $_SESSION['gestock_admin'] = true;
    } else {
        /* Une seconde d'attente : sans elle, on peut essayer des
           milliers de mots de passe à la minute. */
        sleep(1);
        $erreur = 'Mot de passe incorrect.';
    }
}
if (isset($_GET['sortir'])) {
    session_destroy();
    header('Location: admin.php');
    exit;
}

$connecte = !empty($_SESSION['gestock_admin']);

/* --- Actions --- */
$message = '';
if ($connecte && isset($_POST['action'], $_POST['cle'])) {
    $cle = preg_replace('/[^0-9A-Z]/', '', strtoupper((string)$_POST['cle']));
    $db = base();

    if ($_POST['action'] === 'revoquer') {
        $db->prepare("UPDATE licences SET etat = 'revoquee', note = ? WHERE cle = ?")
           ->execute([trim((string)($_POST['note'] ?? '')) ?: null, $cle]);
        $message = 'Licence révoquée. Les postes concernés seront bloqués '
                 . 'à leur prochaine connexion.';
    } elseif ($_POST['action'] === 'liberer') {
        /* Rendre une licence : on efface les postes connus et on la
           remet libre. Le premier qui se manifeste la reprend. */
        $db->prepare('DELETE FROM postes WHERE cle = ?')->execute([$cle]);
        $db->prepare("UPDATE licences SET etat = 'libre', note = NULL WHERE cle = ?")
           ->execute([$cle]);
        $message = 'Licence libérée. Elle peut être réactivée sur un nouveau poste.';
    } elseif ($_POST['action'] === 'vendre') {
        $db->prepare('UPDATE licences SET vendu_a = ?, vendu_le = CURDATE() WHERE cle = ?')
           ->execute([trim((string)($_POST['client'] ?? '')) ?: null, $cle]);
        $message = 'Client enregistré.';
    }
}

/* --- Données --- */
$stats = ['total' => 0, 'libre' => 0, 'active' => 0, 'revoquee' => 0, 'partagees' => 0];
$lignes = [];
$filtre = $_GET['f'] ?? 'actives';
$cherche = trim((string)($_GET['q'] ?? ''));

if ($connecte) {
    $db = base();

    foreach ($db->query('SELECT etat, COUNT(*) n FROM licences GROUP BY etat') as $r) {
        $stats[$r['etat']] = (int)$r['n'];
        $stats['total'] += (int)$r['n'];
    }
    $stats['partagees'] = (int)$db->query('SELECT COUNT(*) FROM partages')->fetchColumn();

    /* Les licences jamais activées sont des milliers : on ne les
       affiche que sur demande. Ce qui intéresse au quotidien, ce sont
       celles qui tournent. */
    $where = match ($filtre) {
        'libres'    => "l.etat = 'libre'",
        'revoquees' => "l.etat = 'revoquee'",
        'partagees' => "l.cle IN (SELECT cle FROM partages)",
        'toutes'    => '1=1',
        default     => "l.etat <> 'libre'",
    };

    $params = [];
    if ($cherche !== '') {
        $where .= ' AND (l.cle LIKE ? OR l.vendu_a LIKE ?)';
        $motif = '%' . preg_replace('/[^0-9A-Za-z ]/', '', strtoupper($cherche)) . '%';
        $params = [$motif, '%' . $cherche . '%'];
    }

    $sql = "SELECT l.cle, l.etat, l.vendu_a, l.vendu_le, l.note,
                   COUNT(p.id) AS nb_postes,
                   MAX(p.dernier_vu) AS derniere_activite
              FROM licences l
              LEFT JOIN postes p ON p.cle = l.cle
             WHERE $where
             GROUP BY l.cle, l.etat, l.vendu_a, l.vendu_le, l.note
             ORDER BY nb_postes DESC, derniere_activite DESC
             LIMIT 300";

    $st = $db->prepare($sql);
    $st->execute($params);
    $lignes = $st->fetchAll();
}

/** Présente une clé par groupes de cinq, comme le client la reçoit. */
function jolie(string $cle): string
{
    return 'GS-' . implode('-', str_split($cle, 5));
}

function quand(?string $t): string
{
    if (!$t) return '—';
    $d = strtotime($t);
    $ecart = time() - $d;
    if ($ecart < 3600) return 'il y a ' . max(1, intdiv($ecart, 60)) . ' min';
    if ($ecart < 86400) return 'il y a ' . intdiv($ecart, 3600) . ' h';
    if ($ecart < 2592000) return 'il y a ' . intdiv($ecart, 86400) . ' j';
    return date('d/m/Y', $d);
}
?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Licences Gestock</title>
<style>
  :root {
    --accent: #10715a;
    --accent-soft: #dbeee7;
    --bg: #f4f6f8;
    --surface: #fff;
    --border: #c9ced4;
    --text: #12161a;
    --dim: #5a6675;
    --danger: #c22a2a;
    --warn: #a96e00;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: var(--bg); color: var(--text);
  }
  h1 { margin: 0 0 18px; font-size: 22px; color: var(--accent); }

  /* Connexion */
  .login {
    max-width: 340px; margin: 12vh auto; padding: 28px;
    background: var(--surface); border-radius: 14px;
    border: 1px solid var(--border); text-align: center;
  }
  .login input {
    width: 100%; padding: 12px; margin: 14px 0;
    border: 1.5px solid var(--border); border-radius: 8px; font-size: 15px;
  }
  .login button {
    width: 100%; padding: 12px; border: 0; border-radius: 8px;
    background: var(--accent); color: #fff; font-size: 15px;
    font-weight: 700; cursor: pointer;
  }

  /* Compteurs */
  .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .stat {
    flex: 1 1 130px; padding: 14px 16px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 12px;
  }
  .stat small {
    display: block; font-size: 11px; text-transform: uppercase;
    letter-spacing: .05em; color: var(--dim); margin-bottom: 4px;
  }
  .stat b { font-size: 22px; font-weight: 800; }
  .stat.alerte b { color: var(--danger); }

  /* Filtres */
  .barre { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; align-items: center; }
  .onglet {
    padding: 7px 14px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--surface); color: var(--dim); text-decoration: none;
    font-size: 13px; font-weight: 600;
  }
  .onglet.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .barre form { margin-left: auto; display: flex; gap: 6px; }
  .barre input {
    padding: 8px 12px; border: 1px solid var(--border);
    border-radius: 8px; font-size: 13px; min-width: 200px;
  }

  /* Tableau */
  .carte {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; overflow: hidden;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th {
    background: var(--accent); color: #fff; text-align: left;
    padding: 12px 14px; font-size: 11px; font-weight: 800;
    text-transform: uppercase; letter-spacing: .05em; white-space: nowrap;
  }
  td { padding: 11px 14px; border-top: 1px solid var(--border); vertical-align: middle; }
  tr:hover td { background: #fafbfc; }
  .cle { font-family: ui-monospace, monospace; font-weight: 700; white-space: nowrap; }

  .etiq {
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 700; white-space: nowrap;
  }
  .etiq.libre { background: #eef0f2; color: var(--dim); }
  .etiq.active { background: var(--accent-soft); color: var(--accent); }
  .etiq.revoquee { background: #fbe3e3; color: var(--danger); }

  .postes { font-weight: 800; }
  .postes.multi { color: var(--danger); }

  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .actions button {
    padding: 6px 11px; border-radius: 7px; border: 1px solid var(--border);
    background: var(--surface); font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .actions button.rouge { color: var(--danger); border-color: #e8b4b4; }
  .actions button:hover { border-color: var(--accent); }

  .avis {
    padding: 12px 16px; margin-bottom: 14px; border-radius: 10px;
    background: var(--accent-soft); color: var(--accent);
    font-size: 13.5px; font-weight: 600;
  }
  .vide { padding: 40px; text-align: center; color: var(--dim); }
  .pied { margin-top: 16px; font-size: 12px; color: var(--dim); }
  .pied a { color: var(--dim); }
</style>
</head>
<body>

<?php if (!$connecte): ?>

  <form class="login" method="post">
    <h1>Licences Gestock</h1>
    <input type="password" name="mdp" placeholder="Mot de passe" autofocus>
    <?php if (isset($erreur)): ?>
      <p style="color:var(--danger);font-size:13px;margin:0 0 10px"><?= htmlspecialchars($erreur) ?></p>
    <?php endif; ?>
    <button type="submit">Entrer</button>
  </form>

<?php else: ?>

  <h1>Licences Gestock</h1>

  <?php if ($message): ?>
    <div class="avis"><?= htmlspecialchars($message) ?></div>
  <?php endif; ?>

  <div class="stats">
    <div class="stat"><small>Total</small><b><?= $stats['total'] ?></b></div>
    <div class="stat"><small>Vendues</small><b><?= $stats['active'] ?></b></div>
    <div class="stat"><small>Disponibles</small><b><?= $stats['libre'] ?></b></div>
    <div class="stat<?= $stats['partagees'] ? ' alerte' : '' ?>">
      <small>Partagées</small><b><?= $stats['partagees'] ?></b>
    </div>
    <div class="stat"><small>Révoquées</small><b><?= $stats['revoquee'] ?></b></div>
  </div>

  <div class="barre">
    <?php foreach ([
      'actives'   => 'En service',
      'partagees' => 'Partagées',
      'revoquees' => 'Révoquées',
      'libres'    => 'Disponibles',
      'toutes'    => 'Toutes',
    ] as $k => $nom): ?>
      <a class="onglet<?= $filtre === $k ? ' on' : '' ?>"
         href="?f=<?= $k ?><?= $cherche ? '&q=' . urlencode($cherche) : '' ?>"><?= $nom ?></a>
    <?php endforeach; ?>

    <form method="get">
      <input type="hidden" name="f" value="<?= htmlspecialchars($filtre) ?>">
      <input name="q" value="<?= htmlspecialchars($cherche) ?>"
             placeholder="Chercher une clé ou un client">
      <button type="submit" style="padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:#fff;cursor:pointer">Chercher</button>
    </form>
  </div>

  <div class="carte">
    <?php if (!$lignes): ?>
      <p class="vide">Aucune licence dans cette vue.</p>
    <?php else: ?>
    <table>
      <thead>
        <tr>
          <th>Clé</th>
          <th>État</th>
          <th>Postes</th>
          <th>Client</th>
          <th>Dernière activité</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
      <?php foreach ($lignes as $l): ?>
        <tr>
          <td class="cle"><?= jolie($l['cle']) ?></td>
          <td><span class="etiq <?= $l['etat'] ?>"><?= $l['etat'] ?></span></td>
          <td class="postes<?= $l['nb_postes'] > 1 ? ' multi' : '' ?>">
            <?= $l['nb_postes'] ?: '—' ?>
          </td>
          <td>
            <form method="post" style="display:flex;gap:4px">
              <input type="hidden" name="action" value="vendre">
              <input type="hidden" name="cle" value="<?= $l['cle'] ?>">
              <input name="client" value="<?= htmlspecialchars((string)$l['vendu_a']) ?>"
                     placeholder="—" style="width:130px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12.5px">
            </form>
          </td>
          <td style="color:var(--dim)"><?= quand($l['derniere_activite']) ?></td>
          <td>
            <div class="actions">
              <?php if ($l['etat'] !== 'revoquee'): ?>
                <form method="post" onsubmit="return confirm('Révoquer cette licence ? Les postes qui l\'utilisent seront bloqués à leur prochaine connexion.')">
                  <input type="hidden" name="action" value="revoquer">
                  <input type="hidden" name="cle" value="<?= $l['cle'] ?>">
                  <input type="hidden" name="note" value="révoquée le <?= date('d/m/Y') ?>">
                  <button class="rouge" type="submit">Révoquer</button>
                </form>
              <?php endif; ?>
              <form method="post" onsubmit="return confirm('Libérer cette licence ? Elle pourra être activée sur un nouveau poste.')">
                <input type="hidden" name="action" value="liberer">
                <input type="hidden" name="cle" value="<?= $l['cle'] ?>">
                <button type="submit">Libérer</button>
              </form>
            </div>
          </td>
        </tr>
        <?php if ($l['note']): ?>
          <tr><td colspan="6" style="padding-top:0;border-top:0;font-size:12px;color:var(--dim)">
            ↳ <?= htmlspecialchars($l['note']) ?>
          </td></tr>
        <?php endif; ?>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php endif; ?>
  </div>

  <p class="pied">
    Le nom du client s'enregistre en quittant le champ.
    &nbsp;·&nbsp; <a href="?sortir=1">Se déconnecter</a>
  </p>

  <script>
    /* Le nom du client part dès qu'on quitte le champ : un bouton par
       ligne alourdirait le tableau pour une saisie rare. */
    for (const champ of document.querySelectorAll('input[name="client"]')) {
      champ.addEventListener('blur', () => champ.form.submit());
      champ.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); champ.form.submit(); }
      });
    }
  </script>

<?php endif; ?>

</body>
</html>
