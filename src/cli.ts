import { buildPlan } from "./plan.ts";
import { SAMPLE_SHADERS } from "./wave64.ts";

const shader = SAMPLE_SHADERS.find((item) => item.name === "visibilité voxel");
if (!shader) throw new Error("shader de référence manquant");

const plan = buildPlan({
  deviceId: "rtx-3060-12",
  sceneId: "city",
  display: { width: 2560, height: 1440 },
  dlss: "quality",
  rtEnabled: true,
  rebar: true,
  mirror: "resident-pages",
  titleMemoryGiB: 10,
  triangles: 2_500_000,
  instances: 8_000,
  bounces: 1,
  procedural: false,
  raysPerPixel: 1,
  shader,
});

process.stdout.write(`${plan.toml}\n`);
