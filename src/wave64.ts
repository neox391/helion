/**
 * Lower Xbox-style wave64 subgroup ops onto a 32-wide host warp.
 * NVIDIA never has a wave64 mode. Pair two warps and use groupshared
 * only when a value actually crosses the 32-lane boundary.
 */

export type LaneRef = { kind: "imm"; value: number } | { kind: "reg"; name: string };

export type GuestOp =
  | { op: "ballot"; dst: string; pred: string }
  | { op: "useMask64"; src: string }
  | { op: "readLane"; dst: string; src: string; lane: LaneRef }
  | { op: "shuffleXor"; dst: string; src: string; mask: number }
  | { op: "laneIndex"; dst: string }
  | { op: "quadSwapX"; dst: string; src: string }
  | { op: "quadSwapY"; dst: string; src: string }
  | { op: "alu"; dst: string; text: string };

export interface GuestShader {
  name: string;
  detail: string;
  waveWidth: 32 | 64;
  threadGroupSize: number;
  ops: GuestOp[];
}

export interface NativeInst {
  id: string;
  hlsl: string;
  reason: string;
}

export interface Legalization {
  shader: string;
  guestWave: 32 | 64;
  hostWave: 32;
  strategy: "identity" | "paired-warps" | "refuse";
  warnings: string[];
  insts: NativeInst[];
  needsGroupSync: boolean;
  smemDwords: number;
  hlsl: string;
}

const PRELUDE = `uint NVX_LocalIndex() { return SV_GroupIndex; }
uint NVX_Pair() { return SV_GroupIndex >> 6; }
uint NVX_Half() { return (SV_GroupIndex >> 5) & 1u; }`;

function hlslOf(strategy: Legalization["strategy"], insts: NativeInst[]): string {
  const body = insts.map((inst) => inst.hlsl.trim()).join("\n\n");
  if (strategy !== "paired-warps") return body;
  return `${PRELUDE}\n\n${body}`;
}

function finish(
  shader: GuestShader,
  strategy: Legalization["strategy"],
  warnings: string[],
  insts: NativeInst[],
  needsGroupSync: boolean,
  smemDwords: number,
): Legalization {
  return {
    shader: shader.name,
    guestWave: shader.waveWidth,
    hostWave: 32,
    strategy,
    warnings,
    insts,
    needsGroupSync,
    smemDwords,
    hlsl: hlslOf(strategy, insts),
  };
}

export function legalize(shader: GuestShader): Legalization {
  if (shader.waveWidth === 32) return legalizeIdentity(shader);
  if (shader.threadGroupSize < 64 || shader.threadGroupSize % 64 !== 0) {
    return finish(
      shader,
      "refuse",
      [
        `Groupe de ${shader.threadGroupSize} threads : un wave64 s'apparie en deux warps de 32, le groupe doit être un multiple de 64.`,
      ],
      [],
      false,
      0,
    );
  }
  return legalizePaired(shader);
}

function legalizeIdentity(shader: GuestShader): Legalization {
  const insts: NativeInst[] = shader.ops.map((op, index) => {
    const id = `${index}-${op.op}`;
    switch (op.op) {
      case "ballot":
        return { id, reason: "Déjà en warp 32.", hlsl: `uint ${op.dst} = WaveActiveBallot(${op.pred});` };
      case "useMask64":
        return {
          id,
          reason: "Le masque hôte fait 32 bits. L'usage 64 bits est un résidu à supprimer.",
          hlsl: `// ${op.src} est uint, pas uint64_t`,
        };
      case "readLane":
        return {
          id,
          reason: "Lane index dans le warp.",
          hlsl:
            op.lane.kind === "imm"
              ? `uint ${op.dst} = WaveReadLaneAt(${op.src}, ${op.lane.value}u);`
              : `uint ${op.dst} = WaveReadLaneAt(${op.src}, ${op.lane.name});`,
        };
      case "shuffleXor":
        return {
          id,
          reason: "XOR intra-warp.",
          hlsl: `uint ${op.dst} = WaveReadLaneAt(${op.src}, WaveGetLaneIndex() ^ ${op.mask}u);`,
        };
      case "laneIndex":
        return { id, reason: "Le warp fait 32 voies.", hlsl: `uint ${op.dst} = WaveGetLaneIndex();` };
      case "quadSwapX":
        return { id, reason: "Quad 2×2 natif.", hlsl: `uint ${op.dst} = QuadReadAcrossX(${op.src});` };
      case "quadSwapY":
        return { id, reason: "Quad 2×2 natif.", hlsl: `uint ${op.dst} = QuadReadAcrossY(${op.src});` };
      case "alu":
        return { id, reason: "ALU inchangée.", hlsl: `uint ${op.dst} = ${op.text};` };
      default:
        return assertNever(op);
    }
  });
  return finish(shader, "identity", [], insts, false, 0);
}

function legalizePaired(shader: GuestShader): Legalization {
  const warnings: string[] = [];
  const mask64 = new Set(
    shader.ops.filter((op): op is { op: "useMask64"; src: string } => op.op === "useMask64").map((op) => op.src),
  );
  const pairs = shader.threadGroupSize / 64;
  const warps = shader.threadGroupSize / 32;
  let smemDwords = 0;
  let needsGroupSync = false;
  const insts: NativeInst[] = [];

  shader.ops.forEach((op, index) => {
    const id = `${index}-${op.op}`;
    switch (op.op) {
      case "ballot": {
        if (!mask64.has(op.dst)) {
          warnings.push(`Ballot « ${op.dst} » gardé sur 32 bits : aucun consommateur ne lit l'autre moitié.`);
          insts.push({
            id,
            reason: "Consommateur intra-moitié.",
            hlsl: `uint ${op.dst} = WaveActiveBallot(${op.pred});`,
          });
          break;
        }
        smemDwords += warps;
        needsGroupSync = true;
        insts.push({
          id,
          reason: "Les deux warps publient leur ballot puis forment un uint64.",
          hlsl: `groupshared uint nvx_ballot_${op.dst}[${warps}];
nvx_ballot_${op.dst}[NVX_LocalIndex() >> 5] = WaveActiveBallot(${op.pred});
GroupMemoryBarrierWithGroupSync();
uint64_t ${op.dst} = (uint64_t)nvx_ballot_${op.dst}[NVX_Pair() * 2u]
  | ((uint64_t)nvx_ballot_${op.dst}[NVX_Pair() * 2u + 1u] << 32);`,
        });
        break;
      }
      case "useMask64":
        insts.push({
          id,
          reason: "Le uint64 est vivant hors du warp.",
          hlsl: `// ${op.src} consommé en 64 bits (stockage, reprise de masque, ou réduction de groupe)`,
        });
        break;
      case "readLane": {
        needsGroupSync = true;
        if (op.lane.kind === "imm") {
          const lane = op.lane.value;
          if (lane < 0 || lane > 63) warnings.push(`Voie ${lane} hors d'un wave64.`);
          smemDwords += pairs;
          insts.push({
            id,
            reason: `La voie ${lane} n'appartient qu'à une moitié. Diffusion par la mémoire partagée du couple.`,
            hlsl: `groupshared uint nvx_pick_${op.dst}[${pairs}];
if ((NVX_LocalIndex() & 63u) == ${lane >>> 0}u) nvx_pick_${op.dst}[NVX_Pair()] = ${op.src};
GroupMemoryBarrierWithGroupSync();
uint ${op.dst} = nvx_pick_${op.dst}[NVX_Pair()];`,
          });
        } else {
          smemDwords += shader.threadGroupSize;
          insts.push({
            id,
            reason: "Index de voie dynamique : publication des 64 valeurs du couple.",
            hlsl: `groupshared uint nvx_dyn_${op.dst}[${shader.threadGroupSize}];
nvx_dyn_${op.dst}[NVX_LocalIndex()] = ${op.src};
GroupMemoryBarrierWithGroupSync();
uint ${op.dst} = nvx_dyn_${op.dst}[(NVX_Pair() << 6) + (${op.lane.name} & 63u)];`,
          });
        }
        break;
      }
      case "shuffleXor": {
        if (op.mask < 0 || op.mask > 63) warnings.push(`Masque XOR ${op.mask} hors wave64.`);
        if (op.mask < 32) {
          insts.push({
            id,
            reason: "Le XOR reste dans le warp de 32.",
            hlsl: `uint ${op.dst} = WaveReadLaneAt(${op.src}, WaveGetLaneIndex() ^ ${op.mask}u);`,
          });
        } else {
          smemDwords += shader.threadGroupSize;
          needsGroupSync = true;
          insts.push({
            id,
            reason: "Le XOR franchit la frontière des 32 voies.",
            hlsl: `groupshared uint nvx_xor_${op.dst}[${shader.threadGroupSize}];
nvx_xor_${op.dst}[NVX_LocalIndex()] = ${op.src};
GroupMemoryBarrierWithGroupSync();
uint ${op.dst} = nvx_xor_${op.dst}[(NVX_Pair() << 6) + ((NVX_LocalIndex() ^ ${op.mask}u) & 63u)];`,
          });
        }
        break;
      }
      case "laneIndex":
        insts.push({
          id,
          reason: "WaveGetLaneIndex() vaut 0..31 sur NVIDIA. L'index invité est linéaire dans le couple.",
          hlsl: `uint ${op.dst} = NVX_LocalIndex() & 63u;`,
        });
        break;
      case "quadSwapX":
        warnings.push("Quad 2×2 laissé intact : ne pas réordonner les voies, les helper lanes du bord de triangle sont dans le même warp.");
        insts.push({
          id,
          reason: "Les quads RDNA ne traversent pas la voie 32.",
          hlsl: `uint ${op.dst} = QuadReadAcrossX(${op.src});`,
        });
        break;
      case "quadSwapY":
        insts.push({
          id,
          reason: "Les quads RDNA ne traversent pas la voie 32.",
          hlsl: `uint ${op.dst} = QuadReadAcrossY(${op.src});`,
        });
        break;
      case "alu":
        insts.push({ id, reason: "ALU inchangée.", hlsl: `uint ${op.dst} = ${op.text};` });
        break;
      default:
        assertNever(op);
    }
  });

  return finish(shader, "paired-warps", dedupe(warnings), insts, needsGroupSync, smemDwords);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function assertNever(value: never): never {
  throw new Error(`opération inconnue: ${JSON.stringify(value)}`);
}

export const SAMPLE_SHADERS: readonly GuestShader[] = [
  {
    name: "visibilité voxel",
    detail: "Ballot sauvé en 64 bits puis relu, cas typique d'un masque de voies restauré.",
    waveWidth: 64,
    threadGroupSize: 64,
    ops: [
      { op: "ballot", dst: "mask", pred: "opaque" },
      { op: "useMask64", src: "mask" },
      { op: "laneIndex", dst: "lane" },
    ],
  },
  {
    name: "échange intra-moitié",
    detail: "XOR 1 reste dans le warp. Aucune barrière.",
    waveWidth: 64,
    threadGroupSize: 128,
    ops: [
      { op: "shuffleXor", dst: "n", src: "v", mask: 1 },
      { op: "alu", dst: "s", text: "n + v" },
    ],
  },
  {
    name: "échange entre moitiés",
    detail: "XOR 32 traverse les deux warps du couple.",
    waveWidth: 64,
    threadGroupSize: 64,
    ops: [{ op: "shuffleXor", dst: "n", src: "v", mask: 32 }],
  },
  {
    name: "quad pixel",
    detail: "Dérivées de pixel : le quad 2×2 et ses helper lanes ne bougent pas.",
    waveWidth: 64,
    threadGroupSize: 64,
    ops: [
      { op: "quadSwapX", dst: "hx", src: "color" },
      { op: "quadSwapY", dst: "hy", src: "color" },
    ],
  },
  {
    name: "lecture de voie",
    detail: "Lecture de la voie 40, absente du warp bas.",
    waveWidth: 64,
    threadGroupSize: 64,
    ops: [{ op: "readLane", dst: "picked", src: "attr", lane: { kind: "imm", value: 40 } }],
  },
  {
    name: "déjà en warp 32",
    detail: "Shader déjà légal pour Ampere. Traduction identité.",
    waveWidth: 32,
    threadGroupSize: 32,
    ops: [
      { op: "ballot", dst: "m", pred: "hit" },
      { op: "laneIndex", dst: "lane" },
    ],
  },
  {
    name: "groupe illégal",
    detail: "32 threads ne portent pas un wave64.",
    waveWidth: 64,
    threadGroupSize: 32,
    ops: [{ op: "laneIndex", dst: "lane" }],
  },
];
