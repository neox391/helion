# Architecture

Helion est une bibliothèque de passes. Chaque passe est pure : un profil de carte et une demande entrent, un plan sort. Rien n'alloue de GPU.

```text
DeviceProfile ─┬─ planPresent  → résolution interne, historique DLSS, Reflex
               ├─ budgetMemory → piscines VRAM, dépassement, conseils
               ├─ planDxr      → chemin de rayons et plafond de bus
               ├─ planQueues   → files et workers, selon le nombre de SM
               └─ legalize     → HLSL hôte pour un shader invité
                        │
                        └─ buildPlan → RuntimePlan + helion.toml
```

Les modules n'ont pas de dépendance entre eux sauf `plan.ts`, qui les compose. Les tests dans `src/helion.test.ts` verrouillent la 3060 12 Go : 3584 shaders, 28 RT cores, 112 Tensor cores, 360 Go/s, pas de Frame Generation, wave64 apparié, descripteurs qui fusionnent.

Un backend D3D12, le jour où il existe, ne devra consommer que le TOML et le HLSL émis. Il ne devra pas réinventer la politique mémoire dans la couche de soumission.

## Hors périmètre volontaire

- Décodage de conteneurs de jeu, signatures, clés.
- Traduction DXIL complète. `legalize` couvre le sous-ensemble qui casse sur un warp 32 : ballot, lecture de voie, shuffle XOR, index de lane, swaps de quad. Le reste de l'ALU passe tel quel.
- Interprétation du format de nœud BVH64. C'est un format de GPU console. On reconstruit une hiérarchie DXR à partir des triangles, ou des AABB si la primitive n'est pas un triangle.

## Ordre de soumission

Même politique que les runtimes existants, rendue explicite : les workers d'upload peuvent préparer des listes en parallèle, mais la file graphique finale conserve l'ordre du titre (barrières, signaux de fence, transitions). Sur GA106 ce parallélisme est petit : 2 workers, 1 file compute.
