export type UberCreationHoldRelease = {
  sourceId:string;storeId:string;platform:'rocket_now'|'demae_can';merchantId:string;
  sourceKey:string;kind:'item'|'option';targetId:string;externalId:string;externalParentId:string;
  inventoryCommandId:string;auditCommandId:string;completedAt:string;capturedAt:string;
  verified:true;isAvailable:true;validation:'persisted-native-audit-v1';
};
export function isCreationHoldReleased(payload:Record<string,unknown>,target:Record<string,unknown>,mapping:Record<string,unknown>|undefined):boolean;
export function creationHoldPhysicalId(platform:string,kind:string,externalId:string,merchantId:string):string;
