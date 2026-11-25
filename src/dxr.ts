import type { DeviceProfile } from "./device.ts";

/**
 * Order-of-magnitude model. `bandwidthSeconds` is a ceiling (rays × bytes / bus),
 * not a measured frame time. Relative cost compares paths on the same card.
 */

export type RtPath = "dxr-inline" | "dxr-traceray" | "procedural-aabb" | "legacy-compute-52";

interface PathModel {
  alu: number;
  bytesPerRay: number;
  label: string;
  build: "hardware-dxr" | "compute-52";
}

const PATHS: Record<RtPath, PathModel> = {
  "dxr-inline": {
    alu: 1,
    bytesPerRay: 64,
    label: "RayQuery inline dans le compute invité",
    build: "hardware-dxr",
  },
  "dxr-traceray": {
    alu: 1.35,
    bytesPerRay: 80,
    label: "Pipeline TraceRay complet",
    build: "hardware-dxr",
  },
  "procedural-aabb": {
    alu: 2.6,
    bytesPerRay: 112,
    label: "AABB procédurales + intersection shader",
    build: "hardware-dxr",
  },
  "legacy-compute-52": {
    alu: 8,
    bytesPerRay: 256,
    label: "52 compute de build et traversée logicielle",
    build: "compute-52",
  },
};

export interface DxrPlan {
  path: RtPath;
  label: string;
  why: string;
  build: PathModel["build"];
  relativeCost: number;
  versusLegacy: number;
  bandwidthSeconds: number;
  legacyBandwidthSeconds: number;
  rays: number;
  notes: string[];
  unsupported: string[];
}

export interface DxrInput {
  device: DeviceProfile;
  width: number;
  height: number;
  triangles: number;
  instances: number;
  bounces: number;
  procedural: boolean;
  raysPerPixel: number;
  forceLegacy?: boolean;
}

function score(path: RtPath, rays: number, device: DeviceProfile): { score: number; seconds: number } {
  const model = PATHS[path];
  const aluScore = (model.alu * (rays / 1e6)) / Math.max(device.rayAccelerators ?? device.sms, 1);
  const seconds = (rays * model.bytesPerRay) / (device.bandwidthGBps * 1e9);
  return { score: aluScore * 0.01 + seconds, seconds };
}

export function planDxr(input: DxrInput): DxrPlan {
  const rays = Math.max(0, Math.round(input.width * input.height * input.raysPerPixel * Math.max(1, input.bounces)));
  let path: RtPath;
  let why: string;
  if (input.forceLegacy || input.device.dxr === "none") {
    path = "legacy-compute-52";
    why = "Repli logiciel. Sur GA106 ce chemin reproduit les frames de plusieurs secondes du build compute.";
  } else if (input.procedural) {
    path = "procedural-aabb";
    why = "Les nœuds non triangulés deviennent des AABB DXR. On ne décode pas le BVH64 AMD dans le shader.";
  } else {
    path = "dxr-inline";
    why = "Le titre traverse en compute et ne teste que le nœud en matériel. RayQuery remplace cet intrinsèque, le build passe par BuildRaytracingAccelerationStructure.";
  }
  const chosen = score(path, rays, input.device);
  const legacy = score("legacy-compute-52", rays, input.device);
  const inline = score("dxr-inline", rays, input.device);
  const notes = [
    `${input.triangles.toLocaleString("fr-FR")} triangles, ${input.instances.toLocaleString("fr-FR")} instances.`,
    path === "legacy-compute-52"
      ? "Build : 52 dispatches compute, chaque frame."
      : "Build : un BuildRaytracingAccelerationStructure matériel, pas les 52 pipelines console.",
    "Le temps affiché est un plafond de bande passante (octets de rayon / bus), pas une mesure.",
  ];
  if (input.bounces > 1 && !input.device.shaderExecutionReordering) {
    notes.push("Sans SER, chaque rebond supplémentaire diverge. Le contrat 3060 s'arrête à ombres + 1 rebond.");
  }
  const unsupported: string[] = [];
  if (!input.device.shaderExecutionReordering) unsupported.push("Shader Execution Reordering");
  if (!input.device.opacityMicromaps) unsupported.push("Opacity Micromaps");
  if (!input.device.frameGeneration) unsupported.push("Frame Generation");
  return {
    path,
    label: PATHS[path].label,
    why,
    build: PATHS[path].build,
    relativeCost: chosen.score / Math.max(inline.score, 1e-12),
    versusLegacy: legacy.score / Math.max(chosen.score, 1e-12),
    bandwidthSeconds: chosen.seconds,
    legacyBandwidthSeconds: legacy.seconds,
    rays,
    notes,
    unsupported,
  };
}
