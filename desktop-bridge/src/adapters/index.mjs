import { DemaeCanAdapter } from "./demae-can.mjs";
import { RocketNowAdapter } from "./rocket-now.mjs";
import { UberEatsAdapter } from "./uber-eats.mjs";

export function createAdapter(platform, session, platformConfig) {
  if (platform === "uber_eats") return new UberEatsAdapter(session, platformConfig);
  if (platform === "rocket_now") return new RocketNowAdapter(session, platformConfig);
  if (platform === "demae_can") return new DemaeCanAdapter(session, platformConfig);
  throw new Error(`unsupported_platform:${platform}`);
}
