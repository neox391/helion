# Rayons sur Ampere

Le chemin Radeon publié traverse en **compute**. Le test de nœud est un intrinsèque (`image_bvh64_intersect_ray` / `image_bvh_intersect_ray`). Le build dynamique, ce sont des dizaines de pipelines compute (les « 52 ») relancés chaque frame. Sur une 7900 XTX ça peut déjà coûter des secondes. Sur 28 RT cores, le recopier tel quel n'a pas de sens : la 3060 n'a pas le débit pour brute-forcer un BVH logiciel en plus du raster.

## Chemin retenu

Triangles disponibles → `BuildRaytracingAccelerationStructure`, puis **RayQuery** inline (DXR 1.1, shader model 6.5+) dans le compute invité.

C'est le remplacement direct de « traversée logicielle + test matériel de nœud », sans pipeline `TraceRay` tant que le shader invité n'est pas un hit group. `TraceRay` reste un plan (`dxr-traceray`) mais n'est pas le défaut : il coûte plus en divergence, et Ampere n'a pas de SER pour la rattraper.

Primitive non triangulaire → AABB DXR + intersection shader (`procedural-aabb`). On ne décode pas les nœuds BVH64 dans le shader.

`forceLegacy` existe pour mesurer le mauvais chemin. Il n'est pas le défaut, et le contrat le met dans `[refuses]`.

## Ce que le modèle chiffre

`planDxr` ne prétend pas à un frametime. Il publie :

- un **plafond de bande passante** : `rayons × octets/rayon / (Go/s × 1e9)`
- un coût relatif au chemin inline, sur la même carte
- le rapport face au chemin 52 compute

Octets par rayon du modèle : 64 (inline), 80 (TraceRay), 112 (AABB), 256 (compute 52). Ce sont des ordres de grandeur pour classer les chemins, pas une trace Nsight.

Rayons = largeur interne × hauteur interne × rayons/pixel × rebonds. La largeur interne vient de DLSS, pas de l'écran. Baisser le présent réduit le plafond avant même de toucher aux RT cores.

## Limites assumées de la 3060

- Pas de Shader Execution Reordering. Au-delà d'un rebond, le conseil est de couper, pas d'ajouter un denoiser plus gros.
- Pas d'Opacity Micromaps. Le feuillage alpha-testé reste un intersection shader ou un any-hit, plus cher.
- Pas de Frame Generation pour « racheter » le coût. Le présent est du DLSS Super Resolution uniquement.
