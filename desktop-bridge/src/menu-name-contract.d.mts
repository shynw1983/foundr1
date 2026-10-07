export const MENU_NAME_CONTRACT_VERSION:'native-name-contract-v1';

export type MenuNameContractIssue = {
  code:'native_name_prohibited_substring';
  rule:'demae-option-size-substring';
  fragment:'size';
};

export function inspectMenuNameContract(platform:string,kind:string,name:string):MenuNameContractIssue[];
