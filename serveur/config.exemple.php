<?php
/**
 * Modèle de configuration du serveur de licences.
 *
 * Copiez ce fichier en `config.php` et renseignez les quatre valeurs.
 * Le vrai `config.php` n'est pas publié : il porte le mot de passe de
 * la base.
 */

declare(strict_types=1);

const BASE_HOTE = 'localhost';
const BASE_NOM  = 'a_remplir';
const BASE_USER = 'a_remplir';
const BASE_MDP  = 'a_remplir';

function base(): PDO
{
    static $db = null;
    if ($db instanceof PDO) {
        return $db;
    }

    $db = new PDO(
        'mysql:host=' . BASE_HOTE . ';dbname=' . BASE_NOM . ';charset=utf8mb4',
        BASE_USER,
        BASE_MDP,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ],
    );
    return $db;
}
