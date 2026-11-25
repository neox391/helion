/** Host profiles for Helion. Bytes are binary (1 Go = 1024³). */

export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;

export type Vendor = "nvidia" | "amd";

export interface DeviceProfile {
  id: string;
  name: string;
  vendor: Vendor;
  chip: string;
  arch: string;
  /** Streaming multiprocessors, or RDNA compute units. */
  sms: number;
  shaders: number;
  /** NVIDIA RT cores, or AMD ray accelerators. Null when absent. */
  rayAccelerators: number | null;
  rayLabel: string;
  tensorCores: number | null;
  vramBytes: number;
  busBits: number;
  bandwidthGBps: number;
  cacheLabel: string;
  cacheBytes: number;
  /** Native SIMT/SIMD width. Both Ampere and RDNA3 execute 32-wide. */
  hostWave: 32;
  /** True only if the silicon can run a 64-wide wave without pairing. */
  nativeWave64: boolean;
  dxr: "1.1" | "none";
  meshShaders: boolean;
  samplerFeedback: boolean;
  dlssSr: boolean;
  /** Hardware frame generation (Ada optical flow). Not DLSS Super Resolution. */
  frameGeneration: boolean;
  shaderExecutionReordering: boolean;
  opacityMicromaps: boolean;
  tdpWatts: number;
  fp32Tflops: number;
  driverReserveBytes: number;
  reference: boolean;
  note: string;
}

function nvidia(partial: Omit<DeviceProfile, "vendor" | "hostWave" | "rayLabel"> & { rayLabel?: string }): DeviceProfile {
  return {
    vendor: "nvidia",
    hostWave: 32,
    rayLabel: partial.rayLabel ?? "RT cores",
    ...partial,
  };
}

export const DEVICES: readonly DeviceProfile[] = [
  nvidia({
    id: "rtx-3060-12",
    name: "GeForce RTX 3060 12 Go",
    chip: "GA106-300",
    arch: "Ampere",
    sms: 28,
    shaders: 3584,
    rayAccelerators: 28,
    tensorCores: 112,
    vramBytes: 12 * GiB,
    busBits: 192,
    bandwidthGBps: 360,
    cacheLabel: "L2",
    cacheBytes: 3 * MiB,
    nativeWave64: false,
    dxr: "1.1",
    meshShaders: true,
    samplerFeedback: true,
    dlssSr: true,
    frameGeneration: false,
    shaderExecutionReordering: false,
    opacityMicromaps: false,
    tdpWatts: 170,
    fp32Tflops: 12.74,
    driverReserveBytes: 768 * MiB,
    reference: true,
    note: "Référence Helion. 12 Go tiennent un jeu de textures Series ; le bus 192 bits, non le nombre de CUDA cores, plafonne le streaming. Pas de Frame Generation, pas de SER.",
  }),
  nvidia({
    id: "rtx-3060-8",
    name: "GeForce RTX 3060 8 Go",
    chip: "GA106-302",
    arch: "Ampere",
    sms: 28,
    shaders: 3584,
    rayAccelerators: 28,
    tensorCores: 112,
    vramBytes: 8 * GiB,
    busBits: 128,
    bandwidthGBps: 240,
    cacheLabel: "L2",
    cacheBytes: 2 * MiB,
    nativeWave64: false,
    dxr: "1.1",
    meshShaders: true,
    samplerFeedback: true,
    dlssSr: true,
    frameGeneration: false,
    shaderExecutionReordering: false,
    opacityMicromaps: false,
    tdpWatts: 170,
    fp32Tflops: 12.74,
    driverReserveBytes: 512 * MiB,
    reference: false,
    note: "Même puce, bus coupé à 128 bits et 8 Go. Mauvais hôte : le streaming Series sature avant les SM.",
  }),
  nvidia({
    id: "rtx-3060-ti",
    name: "GeForce RTX 3060 Ti",
    chip: "GA104-200",
    arch: "Ampere",
    sms: 38,
    shaders: 4864,
    rayAccelerators: 38,
    tensorCores: 152,
    vramBytes: 8 * GiB,
    busBits: 256,
    bandwidthGBps: 448,
    cacheLabel: "L2",
    cacheBytes: 4 * MiB,
    nativeWave64: false,
    dxr: "1.1",
    meshShaders: true,
    samplerFeedback: true,
    dlssSr: true,
    frameGeneration: false,
    shaderExecutionReordering: false,
    opacityMicromaps: false,
    tdpWatts: 200,
    fp32Tflops: 16.2,
    driverReserveBytes: 512 * MiB,
    reference: false,
    note: "Plus de calcul que la 3060 12 Go, moins de mémoire. Pour un titre Series, les 8 Go perdent.",
  }),
  nvidia({
    id: "rtx-3070",
    name: "GeForce RTX 3070",
    chip: "GA104-300",
    arch: "Ampere",
    sms: 46,
    shaders: 5888,
    rayAccelerators: 46,
    tensorCores: 184,
    vramBytes: 8 * GiB,
    busBits: 256,
    bandwidthGBps: 448,
    cacheLabel: "L2",
    cacheBytes: 4 * MiB,
    nativeWave64: false,
    dxr: "1.1",
    meshShaders: true,
    samplerFeedback: true,
    dlssSr: true,
    frameGeneration: false,
    shaderExecutionReordering: false,
    opacityMicromaps: false,
    tdpWatts: 220,
    fp32Tflops: 20.31,
    driverReserveBytes: 512 * MiB,
    reference: false,
    note: "Excellent en raster, toujours coincé à 8 Go. Hors axe tant que la 3060 12 Go n'est pas bouclée.",
  }),
  nvidia({
    id: "rtx-3080-10",
    name: "GeForce RTX 3080 10 Go",
    chip: "GA102-200",
    arch: "Ampere",
    sms: 68,
    shaders: 8704,
    rayAccelerators: 68,
    tensorCores: 272,
    vramBytes: 10 * GiB,
    busBits: 320,
    bandwidthGBps: 760,
    cacheLabel: "L2",
    cacheBytes: 5 * MiB,
    nativeWave64: false,
    dxr: "1.1",
    meshShaders: true,
    samplerFeedback: true,
    dlssSr: true,
    frameGeneration: false,
    shaderExecutionReordering: false,
    opacityMicromaps: false,
    tdpWatts: 320,
    fp32Tflops: 29.77,
    driverReserveBytes: 640 * MiB,
    reference: false,
    note: "Bande passante large, 10 Go justes. Utile comme hôte haut, pas comme première cible.",
  }),
  nvidia({
    id: "rtx-4060",
    name: "GeForce RTX 4060",
    chip: "AD107",
    arch: "Ada",
    sms: 24,
    shaders: 3072,
    rayAccelerators: 24,
    tensorCores: 96,
    vramBytes: 8 * GiB,
    busBits: 128,
    bandwidthGBps: 272,
    cacheLabel: "L2",
    cacheBytes: 24 * MiB,
    nativeWave64: false,
    dxr: "1.1",
    meshShaders: true,
    samplerFeedback: true,
    dlssSr: true,
    frameGeneration: true,
    shaderExecutionReordering: true,
    opacityMicromaps: true,
    tdpWatts: 115,
    fp32Tflops: 15.11,
    driverReserveBytes: 512 * MiB,
    reference: false,
    note: "Ada apporte SER, OMM et la Frame Generation, mais 8 Go en 128 bits. Ces fonctions restent éteintes : l'axe est Ampere 12 Go.",
  }),
  {
    id: "rx-7900-xtx",
    name: "Radeon RX 7900 XTX",
    vendor: "amd",
    chip: "Navi 31",
    arch: "RDNA 3",
    sms: 96,
    shaders: 6144,
    rayAccelerators: 96,
    rayLabel: "accélérateurs rayons",
    tensorCores: null,
    vramBytes: 24 * GiB,
    busBits: 384,
    bandwidthGBps: 960,
    cacheLabel: "Infinity Cache",
    cacheBytes: 96 * MiB,
    hostWave: 32,
    nativeWave64: false,
    dxr: "1.1",
    meshShaders: true,
    samplerFeedback: true,
    dlssSr: false,
    frameGeneration: false,
    shaderExecutionReordering: false,
    opacityMicromaps: false,
    tdpWatts: 355,
    fp32Tflops: 61,
    driverReserveBytes: 1024 * MiB,
    reference: false,
    note: "Carte des mesures Radeon publiées ailleurs. RDNA 3 exécute en wave32 : le wave64 du titre doit quand même être baissé. Helion ne la cible pas.",
  },
];

export function getDevice(id: string): DeviceProfile {
  const found = DEVICES.find((device) => device.id === id);
  if (!found) throw new Error(`carte inconnue: ${id}`);
  return found;
}

export const REFERENCE_DEVICE = getDevice("rtx-3060-12");
