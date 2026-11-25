# Helion

Runtime de traduction GPU pour des charges de type Xbox Series, écrit pour **NVIDIA**.
La carte de référence est la **GeForce RTX 3060 12 Go** (GA106-300, Ampere).

[DexNom/VIctory](https://github.com/DexNom/VIctory) (fork de [Marvisak/VIctory](https://github.com/Marvisak/VIctory)) exécute un binaire Series sur un hôte **Radeon** en Direct3D 12. Helion ne reprend pas ce code et ne lance pas de jeu. Il traite ce que ce chemin ne résout pas sur Ampere, en commençant par une carte de 12 Go sur un bus 192 bits.

```sh
npm test
npm run plan   # écrit le contrat TOML de la référence 3060
```

Node 22. Pas de SDK Windows : les passes sont du TypeScript exécutable tel quel.

## Ce que le dépôt fait

- Profils hôtes. La 3060 12 Go est le contrat. La 3060 8 Go, la 3060 Ti, la 3070, la 3080 10 Go et la 4060 sont là pour montrer pourquoi elles ne le sont pas. La 7900 XTX reste l'hôte de comparaison Radeon.
- Légalisation **wave64 → warp 32**. Ballot `uint64` via deux warps, index de voie linéaire, quads 2×2 laissés en place, XOR qui traverse la moitié seulement quand il le faut.
- Budget de **résidence**. Pages chaudes, tas de descripteurs contigu, anneau ReBAR. Le miroir intégral des ~10 Go du titre est un mode refusé.
- Choix **DXR 1.1**. `RayQuery` inline et `BuildRaytracingAccelerationStructure` à la place des 52 compute de build BVH. Les nœuds non triangulés deviennent des AABB, ils ne sont pas interprétés comme un BVH64 AMD.
- Files GA106 : 1 graphique, 1 compute async, 0 copie si Resizable BAR, 2 workers d'upload.
- Présent : DLSS Super Resolution (Quality par défaut). **Pas de Frame Generation** — la 3060 n'a pas l'optical flow Ada. Reflex n'est qu'une paire de marqueurs.
- Contrat `helion.toml` produit par `buildPlan`.

Les temps de rayons sont un **plafond de bande passante** (octets traversés / bus), pas des millisecondes mesurées. Les scènes (« cité ouverte », « intérieur », « circuit », « forêt ») sont des enveloppes, pas des jeux.

## Ce que le dépôt ne fait pas

- Pas un lanceur, pas un dump, pas de clés, pas de contournement de chiffrement.
- Pas un fork des sources VIctory, victory-world ou xcl. Ces projets ont posé le problème (shaders wave64, mémoire par pages de 64 Kio, build BVH en compute, intrinsèque `image_bvh_intersect_ray`). Aucune ligne n'est copiée.
- Pas de SER, pas d'Opacity Micromaps, pas de Frame Generation sur la référence. Ce sont des fonctions Ada. Les allumer « pour faire moderne » mentirait sur une 3060.
- Pas de backend Direct3D 12 dans cet instantané. Un `Device::Create` qui prétend démarrer un titre serait un faux.

## Pourquoi la 3060 12 Go d'abord

Une Series X voit surtout ~10 Go de mémoire rapide et un GPU RDNA2. Le goulot sur PC n'est pas le même selon la carte :

| | RTX 3060 12 Go | RTX 3060 Ti / 3070 | RTX 4060 | RX 7900 XTX |
|---|---|---|---|---|
| Mémoire | 12 Go, 192 bits, 360 Go/s | 8 Go, 256 bits, 448 Go/s | 8 Go, 128 bits, 272 Go/s | 24 Go, 384 bits, 960 Go/s |
| Exécution | warp 32, jamais de wave64 | warp 32 | warp 32, SER, OMM | wave32 (RDNA 3) |
| Rayons | 28 RT cores, DXR 1.1 | plus de RT cores, 8 Go | 24 RT cores + Ada | DXR possible, chemin publié ailleurs en compute |
| Upscale | DLSS 2, pas de Frame Gen | DLSS 2 | DLSS + Frame Gen | pas de DLSS |

La 3060 Ti calcule plus vite et tient moins de textures. Pour un titre Series, **les 12 Go gagnent**. La bande passante, elle, perd contre une 7900 XTX : d'où le rendu interne DLSS Quality (1440p → 1706×960) et le refus du 4K natif avec rayons sur la scène « cité ».

Le wave64 n'est pas une spécificité Radeon du PC. C'est la largeur **invitée** (le GPU Series sait l'exécuter). Ampere ne peut pas. RDNA 3 non plus en natif. Helion apparie deux warps au lieu d'espérer un mode 64.

## Carte des passes

```text
shader invité wave64
        │  legalize()          warp 32, smem seulement si ça traverse
        ▼
pages résidentes 64 Kio
        │  budgetMemory()      12 Go − réserve pilote − tas − ReBAR
        ▼
géométrie triangulée
        │  planDxr()           BuildRaytracingAccelerationStructure + RayQuery
        ▼
files GA106 + DLSS Quality
        │  planQueues/planPresent
        ▼
helion.toml
```

Détail : [docs/RTX-3060.md](docs/RTX-3060.md), [docs/WAVE64.md](docs/WAVE64.md), [docs/DXR.md](docs/DXR.md), [docs/VRAM.md](docs/VRAM.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contrat de référence

`npm run plan` sur la cité, 1440p, DLSS Quality, rayons, ReBAR, pages résidentes. Le TOML versionné est [helion.example.toml](helion.example.toml). Il doit rester dans les 12 Go (`overflow = false`) et refuser la Frame Generation.

## Licence

MIT. Voir [LICENSE](LICENSE).
