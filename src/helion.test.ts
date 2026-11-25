import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetMemory, getScene } from "./budget.ts";
import { DescriptorHeap } from "./descriptors.ts";
import { getDevice, REFERENCE_DEVICE } from "./device.ts";
import { planDxr } from "./dxr.ts";
import { formatBytes } from "./format.ts";
import { buildPlan } from "./plan.ts";
import { planQueues } from "./queues.ts";
import { SAMPLE_SHADERS, legalize } from "./wave64.ts";

const shader = (name: string) => {
  const found = SAMPLE_SHADERS.find((item) => item.name === name);
  if (!found) throw new Error(name);
  return found;
};

const baseRequest = {
  deviceId: "rtx-3060-12",
  sceneId: "city",
  display: { width: 2560, height: 1440 },
  dlss: "quality" as const,
  rtEnabled: true,
  rebar: true,
  mirror: "resident-pages" as const,
  titleMemoryGiB: 10,
  triangles: 2_500_000,
  instances: 8_000,
  bounces: 1,
  procedural: false,
  raysPerPixel: 1,
  shader: shader("visibilité voxel"),
};

test("la 3060 12 Go est la référence Ampere, sans frame generation", () => {
  assert.equal(REFERENCE_DEVICE.chip, "GA106-300");
  assert.equal(REFERENCE_DEVICE.shaders, 3584);
  assert.equal(REFERENCE_DEVICE.rayAccelerators, 28);
  assert.equal(REFERENCE_DEVICE.tensorCores, 112);
  assert.equal(REFERENCE_DEVICE.vramBytes, 12 * 1024 ** 3);
  assert.equal(REFERENCE_DEVICE.bandwidthGBps, 360);
  assert.equal(REFERENCE_DEVICE.busBits, 192);
  assert.equal(REFERENCE_DEVICE.nativeWave64, false);
  assert.equal(REFERENCE_DEVICE.frameGeneration, false);
  assert.equal(REFERENCE_DEVICE.shaderExecutionReordering, false);
  assert.equal(REFERENCE_DEVICE.dlssSr, true);
  assert.equal(REFERENCE_DEVICE.dxr, "1.1");
});

test("wave64 avec masque vivant devient deux warps et un uint64", () => {
  const result = legalize(shader("visibilité voxel"));
  assert.equal(result.strategy, "paired-warps");
  assert.equal(result.needsGroupSync, true);
  assert.equal(result.smemDwords, 2);
  assert.match(result.hlsl, /uint64_t mask/);
  assert.match(result.hlsl, /GroupMemoryBarrierWithGroupSync/);
  assert.match(result.hlsl, /NVX_LocalIndex\(\) & 63u/);
  assert.doesNotMatch(result.hlsl, /uint lane = WaveGetLaneIndex\(\)/);
});

test("un XOR intra-moitié ne synchronise pas le groupe", () => {
  const result = legalize(shader("échange intra-moitié"));
  assert.equal(result.needsGroupSync, false);
  assert.equal(result.smemDwords, 0);
  assert.match(result.hlsl, /WaveGetLaneIndex\(\) \^ 1u/);
});

test("un XOR 32 traverse le couple de warps", () => {
  const result = legalize(shader("échange entre moitiés"));
  assert.equal(result.needsGroupSync, true);
  assert.equal(result.smemDwords, 64);
  assert.match(result.hlsl, /\^ 32u/);
});

test("les quads restent des QuadRead et ne réordonnent pas les voies", () => {
  const result = legalize(shader("quad pixel"));
  assert.match(result.hlsl, /QuadReadAcrossX/);
  assert.match(result.hlsl, /QuadReadAcrossY/);
  assert.equal(result.needsGroupSync, false);
  assert.ok(result.warnings.some((warning) => warning.includes("helper")));
});

test("la voie 40 passe par la mémoire partagée", () => {
  const result = legalize(shader("lecture de voie"));
  assert.equal(result.smemDwords, 1);
  assert.match(result.hlsl, /== 40u/);
  assert.equal(result.needsGroupSync, true);
});

test("un shader déjà en warp 32 reste une identité", () => {
  const result = legalize(shader("déjà en warp 32"));
  assert.equal(result.strategy, "identity");
  assert.match(result.hlsl, /WaveActiveBallot\(hit\)/);
  assert.match(result.hlsl, /WaveGetLaneIndex\(\)/);
  assert.equal(result.smemDwords, 0);
});

test("un groupe de 32 threads est refusé pour un wave64", () => {
  const result = legalize(shader("groupe illégal"));
  assert.equal(result.strategy, "refuse");
  assert.equal(result.insts.length, 0);
});

test("le budget 1440p Quality tient sur la 3060 12 Go et pas en miroir intégral", () => {
  const fit = buildPlan(baseRequest);
  assert.equal(fit.memory.overflow, false);
  assert.equal(fit.present.internal.width, 1706);
  assert.equal(fit.present.internal.height, 960);
  assert.equal(fit.rt?.path, "dxr-inline");
  assert.equal(fit.queues.asyncCompute, 1);
  assert.equal(fit.queues.copy, 0);
  assert.match(fit.toml, /device = "rtx-3060-12"/);
  assert.match(fit.toml, /mirror = "resident-pages"/);
  assert.match(fit.toml, /frame_generation = "unsupported"/);

  const mirrored = buildPlan({ ...baseRequest, mirror: "full-title" });
  assert.equal(mirrored.memory.overflow, true);
  assert.ok(mirrored.refuses.some((item) => item.includes("Miroir")));
});

test("la 3060 8 Go déborde sur la cité, la 12 Go non", () => {
  const small = buildPlan({ ...baseRequest, deviceId: "rtx-3060-8", display: { width: 1920, height: 1080 }, dlss: "performance" });
  const big = buildPlan({ ...baseRequest, display: { width: 1920, height: 1080 }, dlss: "performance" });
  assert.equal(small.memory.overflow, true);
  assert.equal(big.memory.overflow, false);
  assert.ok(big.memory.headroomBytes > small.memory.headroomBytes);
});

test("le 4K natif avec rayons dépasse les 12 Go de la cité", () => {
  const plan = buildPlan({ ...baseRequest, display: { width: 3840, height: 2160 }, dlss: "off" });
  assert.equal(plan.memory.overflow, true);
  assert.ok(plan.present.notes.some((note) => note.includes("4K")));
});

test("DXR inline coûte moins que les 52 compute, le procédural ne décode pas le BVH64", () => {
  const device = getDevice("rtx-3060-12");
  const inline = planDxr({
    device,
    width: 1706,
    height: 960,
    triangles: 1_000_000,
    instances: 1000,
    bounces: 1,
    procedural: false,
    raysPerPixel: 1,
  });
  const legacy = planDxr({ ...inlineArgs(device), forceLegacy: true });
  assert.equal(inline.path, "dxr-inline");
  assert.equal(inline.build, "hardware-dxr");
  assert.ok(inline.versusLegacy > 2);
  assert.equal(legacy.path, "legacy-compute-52");
  assert.ok(legacy.bandwidthSeconds > inline.bandwidthSeconds);
  const procedural = planDxr({ ...inlineArgs(device), procedural: true });
  assert.equal(procedural.path, "procedural-aabb");
  assert.match(procedural.why, /BVH64/);
  assert.ok(inline.unsupported.includes("Shader Execution Reordering"));
});

test("les descripteurs contigus fusionnent après libération", () => {
  const heap = new DescriptorHeap(100);
  const a = heap.alloc(20);
  const b = heap.alloc(30);
  const c = heap.alloc(10);
  assert.equal(a, 0);
  assert.equal(b, 20);
  assert.equal(c, 50);
  heap.freeRange(20, 30);
  heap.freeRange(0, 20);
  assert.equal(heap.largestFree(), 50);
  assert.equal(heap.alloc(50), 0);
  assert.equal(heap.freeCount(), 40);
  assert.equal(heap.largestFree(), 40);
});

test("les files GA106 restent à un compute async", () => {
  const queues = planQueues(getDevice("rtx-3060-12"), true);
  assert.deepEqual(
    { graphics: queues.graphics, asyncCompute: queues.asyncCompute, copy: queues.copy, uploadWorkers: queues.uploadWorkers },
    { graphics: 1, asyncCompute: 1, copy: 0, uploadWorkers: 2 },
  );
  const staged = planQueues(getDevice("rtx-3060-12"), false);
  assert.equal(staged.copy, 1);
});

test("le format mémoire parle en Go", () => {
  assert.equal(formatBytes(12 * 1024 ** 3), "12.00 Go");
  assert.equal(formatBytes(-512 * 1024 ** 2), "−512 Mo");
});

test("une scène inconnue est une erreur, pas un silence", () => {
  assert.throws(() => getScene("cyber"), /scène inconnue/);
  const amd = buildPlan({ ...baseRequest, deviceId: "rx-7900-xtx", dlss: "quality" });
  assert.equal(amd.present.effective, "nis");
  assert.equal(amd.memory.overflow, false);
});

function inlineArgs(device: ReturnType<typeof getDevice>) {
  return {
    device,
    width: 1706,
    height: 960,
    triangles: 1_000_000,
    instances: 1000,
    bounces: 1,
    procedural: false,
    raysPerPixel: 1,
  };
}

test("le budget résident n'ajoute pas le miroir 10 Go", () => {
  const scene = getScene("interior");
  const plan = budgetMemory({
    device: getDevice("rtx-3060-12"),
    scene,
    internalWidth: 1920,
    internalHeight: 1080,
    rtEnabled: false,
    rebar: true,
    mirror: "resident-pages",
    titleMemoryGiB: 10,
    historyBytes: 0,
  });
  assert.equal(plan.pools.some((pool) => pool.id === "mirror"), false);
  assert.equal(plan.overflow, false);
});
