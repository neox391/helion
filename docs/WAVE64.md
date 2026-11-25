# Wave64 vers warp 32

Les shaders Series qui comptent sont compilés en **wave64**. Le GPU console (RDNA 2) peut les exécuter ainsi. Un warp NVIDIA fait 32 voies, toujours. `WaveGetLaneIndex()` vaut donc 0..31, et `WaveActiveBallot` renvoie un `uint`, pas un `uint64`.

`legalize()` choisit une stratégie :

| Stratégie | Quand |
|---|---|
| `identity` | Le shader est déjà en 32. |
| `paired-warps` | Wave 64 et groupe multiple de 64. Deux warps forment un couple. |
| `refuse` | Wave 64 et groupe non multiple de 64. Rien n'est émis. |

Le couple :

```text
NVX_LocalIndex() = SV_GroupIndex          // 0 .. groupe-1
NVX_Pair()       = SV_GroupIndex >> 6     // couple de 64
NVX_Half()       = (SV_GroupIndex >> 5) & 1
```

## Ce qui reste dans le warp

- `shuffleXor` avec un masque **< 32** → `WaveReadLaneAt(src, WaveGetLaneIndex() ^ masque)`. Pas de barrière.
- `QuadReadAcrossX` / `Y`. Un quad 2×2 tombe sur quatre voies contiguës et ne traverse pas la frontière 32. On ne réordonne pas les voies : les helper lanes d'un bord de triangle doivent rester dans le même warp, sinon le pixel de couture est faux.
- Un ballot dont **aucun** consommateur ne lit l'autre moitié reste un `uint`. Un avertissement le dit, pour ne pas « optimiser » en silence un masque qui serait stocké plus tard.

## Ce qui traverse

- Ballot consommé en 64 bits (`useMask64` : stockage, reprise, réduction de groupe). Chaque warp publie son `WaveActiveBallot` dans `groupshared`, barrière, puis :

```hlsl
uint64_t mask = (uint64_t)ballots[pair * 2]
              | ((uint64_t)ballots[pair * 2 + 1] << 32);
```

- `readLane` d'une voie immédiate. La voie 40 n'existe que dans le warp haut. Une case partagée par couple diffuse la valeur. Une voie dynamique publie les 64 registres du couple.
- `shuffleXor` avec un masque **≥ 32**. Échange par la mémoire partagée du couple.
- L'index de voie invité n'est **pas** `WaveGetLaneIndex()`. C'est `NVX_LocalIndex() & 63`.

La mémoire partagée n'est comptée que pour ces cas (`smemDwords`). Un shader qui n'en a pas besoin ne paie pas de `GroupMemoryBarrierWithGroupSync`. Sur 28 SM, une barrière de groupe dans un fullscreen de visibility se voit.

## Exemples versionnés

`SAMPLE_SHADERS` dans `src/wave64.ts` : visibilité voxel, XOR 1, XOR 32, quad pixel, lecture de la voie 40, identité 32, groupe illégal. Les tests comparent la stratégie, le nombre de dwords et des morceaux de HLSL, pas un dump entier.
