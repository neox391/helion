import type { DeviceProfile } from "./device.ts";

/**
 * DLSS Super Resolution scales (linear). Frame Generation is a separate
 * Ada feature and is never enabled on the RTX 3060 path.
 * Quality 2/3, Balanced ~1/1.724, Performance 1/2, Ultra Performance 1/3.
 */
export type DlssMode = "off" | "quality" | "balanced" | "performance" | "ultra-performance" | "nis";

export const DLSS_MODES: readonly { id: DlssMode; label: string; scale: number }[] = [
  { id: "off", label: "Natif", scale: 1 },
  { id: "quality", label: "DLSS Quality", scale: 2 / 3 },
  { id: "balanced", label: "DLSS Balanced", scale: 1 / 1.724 },
  { id: "performance", label: "DLSS Performance", scale: 1 / 2 },
  { id: "ultra-performance", label: "DLSS Ultra Perf.", scale: 1 / 3 },
  { id: "nis", label: "NIS (spatial)", scale: 2 / 3 },
];

export function modeScale(mode: DlssMode): number {
  return DLSS_MODES.find((item) => item.id === mode)?.scale ?? 1;
}

export interface PresentPlan {
  requested: DlssMode;
  effective: DlssMode;
  display: { width: number; height: number };
  internal: { width: number; height: number };
  historyBytes: number;
  reflex: boolean;
  frameGeneration: "unsupported" | "available-but-off";
  notes: string[];
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded - (rounded % 2);
}

export function historyBytes(
  mode: DlssMode,
  displayW: number,
  displayH: number,
  renderW: number,
  renderH: number,
): number {
  if (mode === "off" || mode === "nis") return 0;
  const colorIn = renderW * renderH * 8;
  const history = displayW * displayH * 8;
  const output = displayW * displayH * 8;
  const motion = renderW * renderH * 4;
  const depth = renderW * renderH * 4;
  return colorIn + history + output + motion + depth;
}

export function planPresent(
  device: DeviceProfile,
  display: { width: number; height: number },
  requested: DlssMode,
): PresentPlan {
  const notes: string[] = [];
  let effective = requested;
  if (!device.dlssSr && requested !== "off" && requested !== "nis") {
    effective = "nis";
    notes.push("Pas de Tensor cores exploitables pour DLSS. Repli sur NIS, sans historique temporel.");
  }
  if (effective === "ultra-performance") {
    notes.push("Ultra Performance est trop mou pour une image Series. Rester en Quality ou Balanced.");
  }
  const scale = modeScale(effective);
  const internal = { width: even(display.width * scale), height: even(display.height * scale) };
  if (display.height >= 2160 && device.bandwidthGBps < 500) {
    notes.push("4K sur un bus étroit : le plafond est la bande passante, pas les shaders.");
  }
  if (effective === "off" && display.height >= 1440 && device.vramBytes <= 12 * 1024 * 1024 * 1024) {
    notes.push("Natif 1440p ou plus sur 12 Go : activer DLSS Quality avant d'allumer les rayons.");
  }
  const frameGeneration: PresentPlan["frameGeneration"] = device.frameGeneration
    ? "available-but-off"
    : "unsupported";
  if (frameGeneration === "unsupported") {
    notes.push("Frame Generation matérielle absente (pas d'accélérateur optical-flow Ada). Ne pas l'émuler.");
  } else {
    notes.push("Frame Generation existe sur cette puce mais reste hors contrat 3060.");
  }
  if (device.vendor === "nvidia") notes.push("Reflex : marqueurs de latence autour de la simulation et du présent, coût mémoire nul.");
  return {
    requested,
    effective,
    display,
    internal,
    historyBytes: historyBytes(effective, display.width, display.height, internal.width, internal.height),
    reflex: device.vendor === "nvidia",
    frameGeneration,
    notes,
  };
}
