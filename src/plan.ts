import { budgetMemory, getScene, type BudgetPlan, type MirrorPolicy, type SceneDemand } from "./budget.ts";
import { getDevice, type DeviceProfile } from "./device.ts";
import { planDxr, type DxrPlan } from "./dxr.ts";
import { planQueues, type QueuePlan } from "./queues.ts";
import { planPresent, type DlssMode, type PresentPlan } from "./upscale.ts";
import { legalize, type GuestShader, type Legalization } from "./wave64.ts";

export interface PlanRequest {
  deviceId: string;
  sceneId: string;
  display: { width: number; height: number };
  dlss: DlssMode;
  rtEnabled: boolean;
  rebar: boolean;
  mirror: MirrorPolicy;
  titleMemoryGiB: number;
  triangles: number;
  instances: number;
  bounces: number;
  procedural: boolean;
  raysPerPixel: number;
  shader: GuestShader;
  forceLegacy?: boolean;
}

export interface RuntimePlan {
  device: DeviceProfile;
  scene: SceneDemand;
  present: PresentPlan;
  memory: BudgetPlan;
  rt: DxrPlan | null;
  queues: QueuePlan;
  wave: Legalization;
  mirror: MirrorPolicy;
  rebar: boolean;
  bounces: number;
  refuses: string[];
  toml: string;
}

export function buildPlan(request: PlanRequest): RuntimePlan {
  const device = getDevice(request.deviceId);
  const scene = getScene(request.sceneId);
  const present = planPresent(device, request.display, request.dlss);
  const memory = budgetMemory({
    device,
    scene,
    internalWidth: present.internal.width,
    internalHeight: present.internal.height,
    rtEnabled: request.rtEnabled,
    rebar: request.rebar,
    mirror: request.mirror,
    titleMemoryGiB: request.titleMemoryGiB,
    historyBytes: present.historyBytes,
  });
  const rt = request.rtEnabled
    ? planDxr({
        device,
        width: present.internal.width,
        height: present.internal.height,
        triangles: request.triangles,
        instances: request.instances,
        bounces: request.bounces,
        procedural: request.procedural,
        raysPerPixel: request.raysPerPixel,
        forceLegacy: request.forceLegacy,
      })
    : null;
  const queues = planQueues(device, request.rebar);
  const wave = legalize(request.shader);
  const refuses: string[] = [];
  if (request.mirror === "full-title") refuses.push("Miroir intégral de l'espace titre.");
  if (present.frameGeneration === "unsupported") refuses.push("Frame Generation matérielle.");
  if (wave.strategy === "refuse") refuses.push(`Shader « ${wave.shader} » : groupe incompatible avec un wave64.`);
  if (rt?.path === "legacy-compute-52") refuses.push("Build BVH par les 52 compute console.");
  if (!device.reference) refuses.push("Carte hors référence. Le contrat prioritaire reste la RTX 3060 12 Go.");
  const plan: RuntimePlan = {
    device,
    scene,
    present,
    memory,
    rt,
    queues,
    wave,
    mirror: request.mirror,
    rebar: request.rebar,
    bounces: request.bounces,
    refuses,
    toml: "",
  };
  plan.toml = toToml(plan);
  return plan;
}

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function toToml(plan: RuntimePlan): string {
  const { device, present, memory, rt, queues, wave } = plan;
  const lines = [
    "# Helion — contrat d'exécution NVIDIA",
    "# Passe de traduction. Ce fichier ne lance pas un jeu.",
    "",
    `device = ${tomlString(device.id)}`,
    `chip = ${tomlString(device.chip)}`,
    `reference = ${device.reference ? "true" : "false"}`,
    "",
    "[wave]",
    `strategy = ${tomlString(wave.strategy)}`,
    `guest_width = ${wave.guestWave}`,
    `host_width = 32`,
    `group_sync = ${wave.needsGroupSync ? "true" : "false"}`,
    `smem_dwords = ${wave.smemDwords}`,
    "",
    "[memory]",
    `mirror = ${tomlString(plan.mirror)}`,
    `rebar = ${plan.rebar ? "true" : "false"}`,
    `vram_bytes = ${memory.vramBytes}`,
    `used_bytes = ${memory.usedBytes}`,
    `headroom_bytes = ${memory.headroomBytes}`,
    `overflow = ${memory.overflow ? "true" : "false"}`,
    "",
    "[present]",
    `mode = ${tomlString(present.effective)}`,
    `display = [${present.display.width}, ${present.display.height}]`,
    `internal = [${present.internal.width}, ${present.internal.height}]`,
    `history_bytes = ${present.historyBytes}`,
    `reflex = ${present.reflex ? "true" : "false"}`,
    `frame_generation = ${tomlString(present.frameGeneration)}`,
    "",
    "[rt]",
    `enabled = ${rt ? "true" : "false"}`,
    `path = ${tomlString(rt?.path ?? "off")}`,
    `build = ${tomlString(rt?.build ?? "off")}`,
    `bounces = ${rt ? plan.bounces : 0}`,
    "",
    "[queues]",
    `graphics = ${queues.graphics}`,
    `async_compute = ${queues.asyncCompute}`,
    `copy = ${queues.copy}`,
    `upload_workers = ${queues.uploadWorkers}`,
    "",
    "[refuses]",
    ...plan.refuses.map((item) => `item = ${tomlString(item)}`),
    "",
  ];
  return lines.join("\n");
}
