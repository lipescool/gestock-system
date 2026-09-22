<?php
/**
 * Enregistrement d'une licence Gestock.
 *
 * L'application appelle ce point d'entrée dès qu'une connexion se
 * présente — pas forcément à l'activation. Elle envoie la clé et
 * l'empreinte du poste ; le serveur répond si cette clé lui
 * appartient.
 *
 * Réponses possibles :
 *   ok        cette clé est à ce poste, tout va bien
 *   prise     la clé est déjà enregistrée sur un autre poste
 *   inconnue  cette clé n'a jamais été émise
 *   revoquee  vous l'avez coupée depuis votre tableau
 *
 * L'application ne bloque jamais sur une absence de réponse : sans
 * réseau, elle continue et réessaiera plus tard.
 */

declare(strict_types=1);

require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

/* L'application est servie depuis un autre domaine : sans ces
   en-têtes, le navigateur bloquerait l'appel avant qu'il parte. */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function repondre(string $etat, array $extra = []): never
{
    echo json_encode(['etat' => $etat] + $extra, JSON_UNESCAPED_UNICODE);
    exit;
}

$corps = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($corps)) {
    repondre('erreur');
}

/* La clé est ramenée à sa forme comparable : sans tirets ni espaces,
   en majuscules, sans le préfixe. L'application fait pareil de son
   côté. */
$cle = strtoupper(preg_replace('/[^0-9A-Za-z]/', '', (string)($corps['cle'] ?? '')));
$cle = preg_replace('/^GS/', '', $cle);
$poste = preg_replace('/[^0-9a-f]/', '', strtolower((string)($corps['poste'] ?? '')));
$boutique = mb_substr(trim((string)($corps['boutique'] ?? '')), 0, 120);

if (strlen($cle) !== 20 || strlen($poste) !== 32) {
    repondre('erreur');
}

try {
    $db = base();

    $st = $db->prepare('SELECT etat FROM licences WHERE cle = ?');
    $st->execute([$cle]);
    $licence = $st->fetch();

    if (!$licence) {
        repondre('inconnue');
    }
    if ($licence['etat'] === 'revoquee') {
        repondre('revoquee');
    }

    /* Ce poste est-il déjà connu pour cette clé ? Si oui, c'est une
       simple reprise de contact : on note le passage et on laisse
       faire. */
    $st = $db->prepare('SELECT id FROM postes WHERE cle = ? AND empreinte = ?');
    $st->execute([$cle, $poste]);

    if ($st->fetch()) {
        $db->prepare('UPDATE postes SET contacts = contacts + 1 WHERE cle = ? AND empreinte = ?')
           ->execute([$cle, $poste]);
        repondre('ok');
    }

    /* Un autre poste utilise-t-il déjà cette clé ? Une licence est
       vendue pour une installation : la seconde est refusée. */
    $st = $db->prepare('SELECT COUNT(*) FROM postes WHERE cle = ?');
    $st->execute([$cle]);

    if ((int)$st->fetchColumn() > 0) {
        repondre('prise');
    }

    /* Premier poste : la licence lui est attribuée. */
    $db->prepare(
        'INSERT INTO postes (cle, empreinte, boutique) VALUES (?, ?, ?)'
    )->execute([$cle, $poste, $boutique ?: null]);

    $db->prepare("UPDATE licences SET etat = 'active' WHERE cle = ?")
       ->execute([$cle]);

    repondre('ok');
} catch (Throwable $e) {
    /* Une panne de base ne doit pas bloquer un commerçant : on répond
       une erreur neutre, et l'application laisse passer. */
    error_log('gestock/activer: ' . $e->getMessage());
    repondre('erreur');
}
