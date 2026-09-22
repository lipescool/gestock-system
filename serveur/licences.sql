-- Base des licences Gestock.
--
-- Deux tables : les clés émises, et les postes qui les utilisent.
-- C'est la seconde qui révèle le partage — une clé vue sur cinq
-- machines n'a pas été achetée cinq fois.

CREATE TABLE IF NOT EXISTS licences (
  cle           VARCHAR(32) NOT NULL PRIMARY KEY,
  -- 'libre' tant qu'aucun poste ne s'est manifesté, 'active' ensuite,
  -- 'revoquee' quand vous décidez de la couper.
  etat          ENUM('libre','active','revoquee') NOT NULL DEFAULT 'libre',
  vendu_a       VARCHAR(120) DEFAULT NULL,
  vendu_le      DATE DEFAULT NULL,
  -- Motif de révocation, pour vous souvenir pourquoi six mois plus tard.
  note          TEXT DEFAULT NULL,
  cree_le       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS postes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cle           VARCHAR(32) NOT NULL,
  -- Empreinte du poste, calculée par l'application. Elle ne permet
  -- pas d'identifier une personne, seulement de distinguer deux
  -- installations.
  empreinte     CHAR(32) NOT NULL,
  boutique      VARCHAR(120) DEFAULT NULL,
  premier_vu    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dernier_vu    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                  ON UPDATE CURRENT_TIMESTAMP,
  contacts      INT UNSIGNED NOT NULL DEFAULT 1,

  UNIQUE KEY poste_unique (cle, empreinte),
  KEY par_cle (cle),
  CONSTRAINT postes_cle FOREIGN KEY (cle) REFERENCES licences(cle)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Les clés partagées, d'un coup d'œil.
CREATE OR REPLACE VIEW partages AS
SELECT
  l.cle,
  l.etat,
  l.vendu_a,
  COUNT(p.id)        AS nb_postes,
  MAX(p.dernier_vu)  AS derniere_activite
FROM licences l
JOIN postes p ON p.cle = l.cle
GROUP BY l.cle, l.etat, l.vendu_a
HAVING COUNT(p.id) > 1
ORDER BY nb_postes DESC;
