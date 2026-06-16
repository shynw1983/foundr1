export type BankMasterBank = {
  code: string;
  name: string;
  kana: string;
  hira?: string;
};

export type BankMasterBranch = {
  bankCode: string;
  code: string;
  name: string;
  kana: string;
  hira?: string;
};

export const builtInBanks: BankMasterBank[] = [
  { code: "0177", name: "福岡銀行", kana: "ﾌｸｵｶ", hira: "ふくおかぎんこう" },
  { code: "0310", name: "GMOあおぞらネット銀行", kana: "ｼﾞｰｴﾑｵｰｱｵｿﾞﾗﾈﾂﾄ", hira: "じーえむおーあおぞらねっとぎんこう" },
  { code: "0190", name: "西日本シティ銀行", kana: "ﾆｼﾆﾂﾎﾟﾝｼﾃｲ", hira: "にしにっぽんしてぃぎんこう" },
  { code: "0001", name: "みずほ銀行", kana: "ﾐｽﾞﾎ", hira: "みずほぎんこう" },
  { code: "0005", name: "三菱UFJ銀行", kana: "ﾐﾂﾋﾞｼﾕｰｴﾌｼﾞｴｲ", hira: "みつびしゆーえふじぇいぎんこう" },
  { code: "0009", name: "三井住友銀行", kana: "ﾐﾂｲｽﾐﾄﾓ", hira: "みついすみともぎんこう" },
  { code: "0033", name: "PayPay銀行", kana: "ﾍﾟｲﾍﾟｲ", hira: "ぺいぺいぎんこう" },
  { code: "0036", name: "楽天銀行", kana: "ﾗｸﾃﾝ", hira: "らくてんぎんこう" },
  { code: "9900", name: "ゆうちょ銀行", kana: "ﾕｳﾁﾖ", hira: "ゆうちょぎんこう" }
];

export const builtInBranches: BankMasterBranch[] = [];
