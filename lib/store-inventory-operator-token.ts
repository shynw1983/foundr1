import { createHmac,timingSafeEqual } from "node:crypto";
import { isStoreInventoryEmployeeRole,storeInventoryUuid } from "./store-inventory-policy";
export const storeInventoryOperatorCookieName="foundr1_store_inventory_operator";
export const storeInventoryOperatorLifetimeMs=15*60*1000;
export type StoreInventoryOperatorToken = {
  purpose:"store_inventory_operator"; terminalEmployeeId:string; terminalSessionId:string; storeId:string;
  operatorEmployeeId:string; operatorSessionVersion:number; operatorRole:string; expiresAt:number;
};
function secret() { return process.env.AUTH_SECRET||process.env.DATABASE_URL||"foundr1-local-dev-secret"; }
function signature(payload:string) { return createHmac("sha256",secret()).update(payload).digest("base64url"); }
export function createStoreInventoryOperatorToken(input:Omit<StoreInventoryOperatorToken,"purpose"|"expiresAt">,now=Date.now()) {
  const value:StoreInventoryOperatorToken={...input,purpose:"store_inventory_operator",expiresAt:now+storeInventoryOperatorLifetimeMs};
  const payload=Buffer.from(JSON.stringify(value)).toString("base64url");
  return {token:`${payload}.${signature(payload)}`,expiresAt:new Date(value.expiresAt).toISOString()};
}
export function readStoreInventoryOperatorToken(token:unknown,now=Date.now()):{value:StoreInventoryOperatorToken|null;expired:boolean} {
  if(typeof token!=="string"||token.length>3000)return {value:null,expired:false};
  const parts=token.split(".");if(parts.length!==2)return {value:null,expired:false};
  const [payload,mac]=parts;
  const actual=Buffer.from(mac),expected=Buffer.from(signature(payload));
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return {value:null,expired:false};
  try {
    const value=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as StoreInventoryOperatorToken;
    if(value.purpose!=="store_inventory_operator"||!storeInventoryUuid.test(value.terminalEmployeeId)||!storeInventoryUuid.test(value.terminalSessionId)
      ||!storeInventoryUuid.test(value.storeId)||!storeInventoryUuid.test(value.operatorEmployeeId)||!isStoreInventoryEmployeeRole(value.operatorRole)
      ||!Number.isInteger(value.operatorSessionVersion)||value.operatorSessionVersion<0||!Number.isSafeInteger(value.expiresAt))return {value:null,expired:false};
    if(value.expiresAt<=now)return {value:null,expired:true};
    return {value,expired:false};
  }catch{return {value:null,expired:false};}
}
export function storeInventoryOperatorCookie(token:string,maxAgeSeconds=storeInventoryOperatorLifetimeMs/1000) {
  return `${storeInventoryOperatorCookieName}=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${process.env.NODE_ENV==="production"?"; Secure":""}`;
}
