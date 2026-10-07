export const MENU_NAME_CONTRACT_VERSION='native-name-contract-v1';

/** Only native name restrictions independently confirmed in a live operation
 * belong here. The Demae option rule is a case-insensitive substring rule,
 * not a whole-word rule, and does not authorize rewriting a source name. */
export function inspectMenuNameContract(platform,kind,name) {
  if(platform==='demae_can'&&kind==='option'&&name.toLowerCase().includes('size')) {
    return [{code:'native_name_prohibited_substring',rule:'demae-option-size-substring',fragment:'size'}];
  }
  return [];
}
