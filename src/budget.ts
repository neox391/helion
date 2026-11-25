import { DESCRIPTOR_BYTES, REFERENCE_VIEW_CAPACITY, SAMPLER_HEAP_CAPACITY } from "./descriptors.ts";
import { GiB, MiB, type DeviceProfile } from "./device.ts";

/** Hot sets are envelopes for a Series-class workload, not a measured title. */
export interface SceneDemand {
  id: string;
  label: string;
  detail: string;
  texturesMiB: number;
  /** Color, depth and material targets authored at 1920×1080. Scaled with internal pixels. */
  renderTargetsMiB: number;
  rtAccelMiB: number;
  meshMiB: number;
  /** 0 = stable working set, 1 = the set is replaced every few frames. */
  streamPressure: number;
}

export const SCENES: readonly SceneDemand[] = [
  {
    id: "city",
    label: "Cité ouverte",
    detail: "Jeu de textures résident large, structures d'accélération moyennes, streaming continu.",
    texturesMiB: 8600,
    renderTargetsMiB: 420,
    rtAccelMiB: 900,
    meshMiB: 640,
    streamPressure: 0.72,
  },
  {
    id: "interior",
    label: "Intérieur dense",
    detail: "Emprise mémoire plus faible, beaucoup de matériaux uniques, rayons courts.",
    texturesMiB: 2800,
    renderTargetsMiB: 260,
    rtAccelMiB: 400,
    meshMiB: 280,
    streamPressure: 0.35,
  },
  {
    id: "race",
    label: "Circuit rapide",
    detail: "Peu de rayons, gros maillages, le budget part dans la cadence et le streaming.",
    texturesMiB: 4800,
    renderTargetsMiB: 180,
    rtAccelMiB: 120,
    meshMiB: 700,
    streamPressure: 0.85,
  },
  {
    id: "forest",
    label: "Forêt et volumes",
    detail: "Accélération lourde, cibles épaisses, textures intermédiaires.",
    texturesMiB: 5200,
    renderTargetsMiB: 640,
    rtAccelMiB: 1400,
    meshMiB: 500,
    streamPressure: 0.5,
  },
];

export function getScene(id: string): SceneDemand {
  const found = SCENES.find((scene) => scene.id === id);
  if (!found) throw new Error(`scène inconnue: ${id}`);
  return found;
}

export type MirrorPolicy = "resident-pages" | "full-title";

export interface MemoryPool {
  id: string;
  label: string;
  bytes: number;
  pinned: boolean;
  note: string;
}

export interface BudgetPlan {
  pools: MemoryPool[];
  vramBytes: number;
  usedBytes: number;
  headroomBytes: number;
  overflow: boolean;
  advice: string[];
}

const PSO_BYTES = 128 * MiB;
const UPLOAD_REBAR = 64 * MiB;
const UPLOAD_STAGING = 256 * MiB;
const REF_PIXELS = 1920 * 1080;

export interface BudgetInput {
  device: DeviceProfile;
  scene: SceneDemand;
  internalWidth: number;
  internalHeight: number;
  rtEnabled: boolean;
  rebar: boolean;
  mirror: MirrorPolicy;
  /** Guest title space that a naive full mirror would pin. Series-class default: 10. */
  titleMemoryGiB: number;
  historyBytes: number;
}

export function budgetMemory(input: BudgetInput): BudgetPlan {
  const { device, scene } = input;
  const pixelScale = (input.internalWidth * input.internalHeight) / REF_PIXELS;
  const viewBytes = REFERENCE_VIEW_CAPACITY * DESCRIPTOR_BYTES;
  const samplerBytes = SAMPLER_HEAP_CAPACITY * DESCRIPTOR_BYTES;
  const upload = input.rebar ? UPLOAD_REBAR : UPLOAD_STAGING;
  const targets = Math.round(scene.renderTargetsMiB * MiB * pixelScale);
  const accel = input.rtEnabled ? scene.rtAccelMiB * MiB : 0;
  const textures = scene.texturesMiB * MiB;
  const mesh = scene.meshMiB * MiB;
  const mirrorBytes = input.mirror === "full-title" ? input.titleMemoryGiB * GiB : 0;

  const pools: MemoryPool[] = [
    {
      id: "driver",
      label: "Réserve pilote",
      bytes: device.driverReserveBytes,
      pinned: true,
      note: "WDDM et le pilote gardent une part non négociable.",
    },
    {
      id: "views",
      label: "Tas de vues",
      bytes: viewBytes + samplerBytes,
      pinned: true,
      note: `${REFERENCE_VIEW_CAPACITY.toLocaleString("fr-FR")} vues + ${SAMPLER_HEAP_CAPACITY} samplers, 32 octets.`,
    },
    {
      id: "pso",
      label: "Pipelines résidents",
      bytes: PSO_BYTES,
      pinned: true,
      note: "PSO et caches GPU chauds, pas le cache disque.",
    },
    {
      id: "upload",
      label: input.rebar ? "Anneau upload ReBAR" : "Staging sans ReBAR",
      bytes: upload,
      pinned: true,
      note: input.rebar
        ? "Tas mappé persistant. La file copie n'est pas nécessaire."
        : "Sans Resizable BAR l'anneau triple et une copie GPU s'ajoutent.",
    },
    {
      id: "targets",
      label: "Cibles internes",
      bytes: targets,
      pinned: true,
      note: "Mises à l'échelle depuis 1920×1080 selon le rendu interne.",
    },
    {
      id: "history",
      label: "Historique upscale",
      bytes: input.historyBytes,
      pinned: true,
      note: "Couleur, historique, vecteurs et profondeur. Nul en natif ou en NIS.",
    },
    {
      id: "accel",
      label: "Structures DXR",
      bytes: accel,
      pinned: input.rtEnabled,
      note: input.rtEnabled ? "BLAS + TLAS reconstruits, pas le format BVH64 console." : "Rayons éteints.",
    },
    {
      id: "mesh",
      label: "Maillages résidents",
      bytes: mesh,
      pinned: false,
      note: "Géométrie chaude. Le reste reste sur l'hôte.",
    },
    {
      id: "textures",
      label: "Textures résidentes",
      bytes: textures,
      pinned: false,
      note: "Pages réellement présentes. Ce n'est pas tout le jeu.",
    },
  ];
  if (mirrorBytes > 0) {
    pools.push({
      id: "mirror",
      label: "Miroir intégral du titre",
      bytes: mirrorBytes,
      pinned: true,
      note: "Chaque page invitée dupliquée. Intenable sur 12 Go.",
    });
  }

  const usedBytes = pools.reduce((sum, pool) => sum + pool.bytes, 0);
  const headroomBytes = device.vramBytes - usedBytes;
  const overflow = headroomBytes < 0;
  const advice: string[] = [];
  if (input.mirror === "full-title") {
    advice.push("Miroir intégral refusé en production. Ne garder que les pages résidentes de 64 Kio.");
  }
  if (!input.rebar) {
    advice.push("Activer Resizable BAR. Sans lui, les uploads Series passent par une copie de plus.");
  }
  if (overflow) {
    advice.push("Le résident ne tient pas. Baisser le rendu interne, couper les rayons, ou évincer des textures.");
  } else if (headroomBytes < 512 * MiB) {
    advice.push("Moins de 512 Mo de marge. Le premier pic de streaming va évincer la cible de profondeur.");
  }
  if (scene.streamPressure >= 0.7 && device.bandwidthGBps < 400) {
    advice.push("Pression de streaming haute et bus sous 400 Go/s. Priorité au feedback de samplers, pas à un plus gros tas.");
  }
  if (device.vramBytes <= 8 * GiB) {
    advice.push("8 Go ou moins : cette carte n'est pas la référence. Le 12 Go de la 3060 est le contrat.");
  }
  if (!overflow && input.mirror === "resident-pages" && input.rebar) {
    advice.push("Contrat mémoire nominal : pages résidentes, ReBAR, pas de second exemplaire CPU du titre en VRAM.");
  }

  return { pools, vramBytes: device.vramBytes, usedBytes, headroomBytes, overflow, advice };
}
