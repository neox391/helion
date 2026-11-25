# Mémoire sur 12 Go

`budgetMemory` additionne des piscines et compare à `device.vramBytes`. Dépassement = le plan est illégal pour cette carte, pas un OOM silencieux plus tard.

## Piscines

| Id | Épinglée | Contenu |
|---|---|---|
| `driver` | oui | Réserve WDDM. 768 Mo sur la 3060 12 Go. |
| `views` | oui | 262 144 vues CBV/SRV/UAV + 2 048 samplers, 32 octets. Environ 8 Mo. Le plafond matériel est à un million de descripteurs ; on ne le réserve pas. |
| `pso` | oui | 128 Mo de pipelines réellement chauds. |
| `upload` | oui | 64 Mo si ReBAR, 256 Mo sinon. |
| `targets` | oui | Cibles couleur/profondeur/matériau, auteurées à 1920×1080, mises à l'échelle par le nombre de pixels internes. |
| `history` | oui | Historique DLSS (couleur interne, historique écran, sortie, vecteurs, profondeur). Nul en natif et en NIS. |
| `accel` | si rayons | BLAS + TLAS de la scène. Pas le BVH console. |
| `mesh` | non | Maillages chauds. |
| `textures` | non | Jeu résident, pas l'archive entière du titre. |
| `mirror` | oui | Uniquement si la politique `full-title` est demandée. 10 Go par défaut. Refusé en production. |

## Politique

`resident-pages` : seules les pages de 64 Kio réellement utilisées occupent le GPU. Un annuaire peut exister côté CPU ; il ne duplique pas l'espace titre en VRAM.

`full-title` : épingler ~10 Go de miroir. Sur 12 Go, avec les cibles et les textures de la cité, ça dépasse. Le test de référence le verrouille. C'est le pied posé sur le rateau « on mappe toute la mémoire console ».

Les descripteurs se allouent par plage contiguë (first-fit) et fusionnent à la libération. Voir `DescriptorHeap`. Sous pression, une texture déjà résidente réutilise son emplacement au lieu d'échouer sur un trou.

## Scènes

Enveloppes, pas des mesures :

- **Cité ouverte** — 8600 Mo de textures résidentes, accélération moyenne. 1440p DLSS Quality tient. 4K natif avec rayons ne tient pas. 8 Go ne tient pas, même en 1080p Performance.
- **Intérieur dense** — jeu petit, tient largement.
- **Circuit** — peu de rayons, grosse pression de streaming. Le conseil bande passante se déclenche sous 400 Go/s.
- **Forêt** — accélération et cibles lourdes.

La marge sous 512 Mo est signalée : le prochain pic de streaming évince la profondeur avant les textures, et l'image clignote.

## Sampler feedback

Avec un bus à 360 Go/s et une pression de streaming ≥ 0,7, le plan demande du feedback de samplers plutôt qu'un tas plus gros. Charger plus large ne fait que pousser le dépassement. La 3060 a le feedback matériel (DX12 Ultimate). S'en servir est le levier, pas un preset « ultra textures ».
