import type { DeviceProfile } from "./device.ts";

export interface QueuePlan {
  graphics: number;
  asyncCompute: number;
  copy: number;
  uploadWorkers: number;
  notes: string[];
}

/** GA106 has 28 SMs. A second async compute queue steals the raster. */
export function planQueues(device: DeviceProfile, rebar: boolean): QueuePlan {
  const small = device.sms <= 30;
  const notes: string[] = [];
  const asyncCompute = small ? 1 : 2;
  const uploadWorkers = small ? 2 : 4;
  const copy = rebar ? 0 : 1;
  notes.push(
    small
      ? `${device.sms} SM : une seule file compute async. Une seconde file vole le raster au lieu de le recouvrir.`
      : `${device.sms} unités : deux files compute async restent rentables pour le build DXR.`,
  );
  notes.push(
    rebar
      ? "Resizable BAR : écriture CPU directe dans le tas d'upload, file copie à zéro."
      : "Sans ReBAR : une file copie dédiée. L'ordre de soumission du titre reste celui de la file graphique.",
  );
  notes.push(`${uploadWorkers} workers CPU pour les lots d'upload. Le bus ${device.busBits} bits sature avant le CPU.`);
  if (device.vendor !== "nvidia") {
    notes.push("Hôte de comparaison uniquement. Les files Helion sont écrites pour la file NVIDIA.");
  }
  return { graphics: 1, asyncCompute, copy, uploadWorkers, notes };
}
