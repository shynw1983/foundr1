export type SalesSourcePlatform = "smaregi" | "foundr1_pos" | "web_reservation" | "uber_eats" | "rocket_now" | "demae_can";

export type SalesSourceDefinition = {
  platform: SalesSourcePlatform;
  label: string;
  sourceType: "pos" | "web" | "delivery";
  importSupported: boolean;
};

export const salesSourceDefinitions: SalesSourceDefinition[] = [
  { platform: "smaregi", label: "Smaregi", sourceType: "pos", importSupported: false },
  { platform: "foundr1_pos", label: "Foundr1 POS", sourceType: "pos", importSupported: false },
  { platform: "web_reservation", label: "Web予約", sourceType: "web", importSupported: false },
  { platform: "uber_eats", label: "Uber Eats", sourceType: "delivery", importSupported: true },
  { platform: "rocket_now", label: "Rocket Now", sourceType: "delivery", importSupported: false },
  { platform: "demae_can", label: "出前館", sourceType: "delivery", importSupported: false }
];

export function getSalesSourceDefinition(platform: string) {
  return salesSourceDefinitions.find((source) => source.platform === platform);
}

export function getSalesSourceLabel(platform: string) {
  return getSalesSourceDefinition(platform)?.label ?? platform;
}
