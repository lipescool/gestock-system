<?php
/**
 * Charge les clés dans la base, une seule fois.
 *
 * Déposez cles-gestock.txt à côté de ce fichier, ouvrez-le dans le
 * navigateur, puis SUPPRIMEZ-LE du serveur.
 *
 * Relancer ne fait pas de doublon : les clés déjà présentes sont
 * ignorées, et leur état n'est pas touché.
 */

declare(strict_types=1);

require __DIR__ . '/config.php';

header('Content-Type: text/plain; charset=utf-8');

$fichier = __DIR__ . '/cles-gestock.txt';
if (!is_readable($fichier)) {
    exit("Fichier introuvable : cles-gestock.txt\n");
}

$db = base();
$st = $db->prepare('INSERT IGNORE INTO licences (cle) VALUES (?)');

$ajoutees = 0;
$vues = 0;

foreach (file($fichier, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $ligne) {
    $cle = strtoupper(preg_replace('/[^0-9A-Za-z]/', '', $ligne));
    $cle = preg_replace('/^GS/', '', $cle);
    if (strlen($cle) !== 20) {
        continue;
    }
    $vues++;
    $st->execute([$cle]);
    $ajoutees += $st->rowCount();
}

echo "Clés lues      : $vues\n";
echo "Clés ajoutées  : $ajoutees\n";
echo "Déjà présentes : " . ($vues - $ajoutees) . "\n";
echo "\nSUPPRIMEZ CE FICHIER ET cles-gestock.txt DU SERVEUR.\n";
