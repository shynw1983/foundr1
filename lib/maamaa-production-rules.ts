export type MaamaaProductionRule = {
  id?: string;
  customerName: string;
  aliases?: string[];
  section: "noodles" | "base" | "standard" | "premium" | "vip" | "request" | "seasoning" | "set" | "operation";
  kitchenName: string;
  quantity?: string;
  prep?: string;
  action?: string;
  minimumHeatMinutes?: number;
  placement?: "pot" | "container" | "finish";
  notes?: string;
};

export type MaamaaSeasoningRule = {
  name: string;
  lines: string[];
};

export type MaamaaSetRule = {
  name: string;
  defaultItems: string[];
  notes?: string;
};

const normalize = (value: string) =>
  value
    .replace(/\s+/g, "")
    .replace(/[　]/g, "")
    .replace(/[１]/g, "1")
    .replace(/[２]/g, "2")
    .replace(/[３]/g, "3")
    .replace(/[０]/g, "0")
    .trim();

export const maamaaProductionRules: MaamaaProductionRule[] = [
  { id: "wide-harusame", section: "noodles", customerName: "もちもち板春雨", kitchenName: "板春雨", quantity: "50g", prep: "2時間水につける", action: "麺変更時はデフォルト板春雨の置き換え。板春雨追加は別途50g追加。", placement: "pot" },
  { id: "wide-harusame-extra", section: "noodles", customerName: "板春雨追加", kitchenName: "板春雨", quantity: "追加50g", prep: "2時間水につける", action: "元々の板春雨50gに追加する", placement: "pot" },
  { id: "beef-noodle", section: "noodles", customerName: "牛筋麺", kitchenName: "牛筋麺", quantity: "50g", prep: "4時間水につける", action: "麺変更時はデフォルト板春雨の置き換え", placement: "pot" },
  { id: "harusame", section: "noodles", customerName: "春雨", kitchenName: "春雨", quantity: "40g", action: "煮込まず、容器に入れる", placement: "container" },
  { id: "tteokbokki", section: "noodles", customerName: "トッポッキ", kitchenName: "トッポッキ", quantity: "50g", placement: "pot" },
  { id: "sweet-potato-noodle", section: "noodles", customerName: "さつまいも麺", kitchenName: "さつまいも麺", quantity: "50g", placement: "pot" },

  { id: "squid-ball", section: "base", customerName: "特選イカ団子1個", kitchenName: "冷凍イカ団子", quantity: "1個", minimumHeatMinutes: 5, placement: "pot" },
  { id: "beef-ball", section: "base", customerName: "特選牛肉団子1個", kitchenName: "冷凍牛肉団子", quantity: "1個", minimumHeatMinutes: 5, placement: "pot" },
  { id: "pork-ball", section: "base", customerName: "特選豚団子1個", kitchenName: "特選豚団子", quantity: "1個", minimumHeatMinutes: 5, placement: "pot" },
  { id: "wonton", section: "base", customerName: "特製ワンタン1個", kitchenName: "ワンタン", quantity: "1個", minimumHeatMinutes: 2, placement: "pot" },
  { id: "quail-egg", section: "base", customerName: "うずらの卵1個", kitchenName: "うずらの卵", quantity: "1個", placement: "pot" },
  { id: "tofu-skin", section: "base", customerName: "火鍋豆皮", kitchenName: "乾燥火鍋豆皮", quantity: "1枚", prep: "水で洗う", minimumHeatMinutes: 5, placement: "pot" },
  { id: "fresh-yuba", section: "base", customerName: "生腐竹", kitchenName: "生腐竹", quantity: "50g", placement: "pot", notes: "店内表記と実物を要確認" },
  { id: "knotted-yuba", section: "base", customerName: "結びゆば1個", kitchenName: "冷凍結びゆば", quantity: "1個", minimumHeatMinutes: 2, placement: "pot" },
  { id: "crab-ball", section: "base", customerName: "魚卵入り蟹団子1個", kitchenName: "冷凍蟹団子", quantity: "1個", minimumHeatMinutes: 3, placement: "pot" },

  { id: "bok-choy", section: "standard", customerName: "チンゲン菜", kitchenName: "チンゲン菜", quantity: "40g", prep: "水でさっと洗う", placement: "pot" },
  { id: "broccoli", section: "standard", customerName: "ブロッコリー", kitchenName: "冷凍ブロッコリー", quantity: "50g", placement: "pot" },
  { id: "duck-blood", section: "standard", customerName: "鴨の血1枚", kitchenName: "冷凍鴨の血", quantity: "1枚", placement: "pot" },
  { id: "sausage", section: "standard", customerName: "ウインナー1個", kitchenName: "ウインナー", quantity: "1個", placement: "pot" },
  { id: "kanikama", section: "standard", customerName: "カニカマ", kitchenName: "冷凍カニカマ", quantity: "50g", placement: "pot" },
  { id: "dried-tofu", section: "standard", customerName: "干し豆腐", kitchenName: "干し豆腐", quantity: "1個", action: "乾燥したまま鍋に入れる", placement: "pot" },
  { id: "garlic", section: "standard", customerName: "にんにく1粒", kitchenName: "冷凍にんにく", quantity: "1個", placement: "pot" },
  { id: "tomato", section: "standard", customerName: "プチトマト1個", kitchenName: "プチトマト", quantity: "1個", prep: "ヘタを取る", placement: "pot" },
  { id: "wakame", section: "standard", customerName: "わかめ", kitchenName: "乾燥わかめ", quantity: "5g", action: "乾燥したまま容器に入れる", placement: "container" },
  { id: "pork-tongue", section: "standard", customerName: "豚タン", aliases: ["国産 豚タン 約50g"], kitchenName: "冷凍豚タン", quantity: "50g", action: "鍋に入れたあとよくほぐす", placement: "pot" },
  { id: "nira", section: "standard", customerName: "ニラ", kitchenName: "ニラ", quantity: "30g", prep: "3-4cmに切る", placement: "pot" },
  { id: "okra", section: "standard", customerName: "オクラ1本", kitchenName: "冷凍オクラ", quantity: "1本", placement: "pot" },
  { id: "asparagus", section: "standard", customerName: "グリーンアスパラガス1本", kitchenName: "冷凍グリーンアスパラガス", quantity: "1本", placement: "pot" },
  { id: "potato", section: "standard", customerName: "じゃがいも", kitchenName: "カットじゃがいも", quantity: "50g", notes: "常温がない時は冷凍を使う", placement: "pot" },
  { id: "sweet-potato", section: "standard", customerName: "さつまいも", kitchenName: "カットさつまいも", quantity: "50g", notes: "常温がない時は冷凍を使う", placement: "pot" },
  { id: "enoki", section: "standard", customerName: "えのき", kitchenName: "えのき", quantity: "40g", placement: "pot" },
  { id: "shimeji", section: "standard", customerName: "しめじ", kitchenName: "しめじ", quantity: "40g", placement: "pot" },
  { id: "eringi", section: "standard", customerName: "エリンギ", kitchenName: "エリンギ", quantity: "40g", placement: "pot" },
  { id: "wood-ear", section: "standard", customerName: "黒キクラゲ", kitchenName: "黒キクラゲ", quantity: "7個くらい", prep: "水で洗う", placement: "pot" },
  { id: "white-negi", section: "standard", customerName: "白ネギ", kitchenName: "白ネギ", quantity: "50g", prep: "白いところを3-4cmに切る", placement: "pot" },
  { id: "spam", section: "standard", customerName: "スパム1枚", kitchenName: "冷凍スパム", quantity: "1枚", placement: "pot" },
  { id: "hakusai", section: "standard", customerName: "白菜", kitchenName: "白菜", quantity: "50g", placement: "pot" },
  { id: "pumpkin", section: "standard", customerName: "かぼちゃ", kitchenName: "冷凍かぼちゃ", quantity: "50g", placement: "pot" },
  { id: "tofu", section: "standard", customerName: "豆腐", kitchenName: "豆腐", quantity: "1パック", prep: "4等分にカットして全部入れる", placement: "pot" },

  { id: "beef-suji", section: "premium", customerName: "とろとろ牛すじ", aliases: ["国産牛すじ 50g"], kitchenName: "冷凍小分け牛すじ", quantity: "50g 1袋", placement: "pot" },
  { id: "pork-cartilage", section: "premium", customerName: "とろとろ豚軟骨", aliases: ["国産豚軟骨 50g"], kitchenName: "冷凍小分け豚軟骨", quantity: "50g 1袋", placement: "pot" },
  { id: "pork-head", section: "premium", customerName: "厳選国産豚肉スライス", aliases: ["国産豚肉スライス", "豚肉スライス"], kitchenName: "冷凍豚あたまスライス", quantity: "50g", placement: "pot" },
  { id: "lamb", section: "premium", customerName: "厳選ラム肉", aliases: ["高級NZ羊ラム 50g"], kitchenName: "冷凍ラム肉", quantity: "50g", action: "鍋に入れたあとこまめにほぐす", placement: "pot" },
  { id: "pork-offal", section: "premium", customerName: "ぷりぷり国産牛モツ", aliases: ["国産牛モツ 50g"], kitchenName: "冷凍小分け牛モツ", quantity: "50g 1袋", placement: "pot" },
  { id: "large-shrimp", section: "premium", customerName: "大えび一匹", kitchenName: "冷凍ブラックタイガー", quantity: "1匹", minimumHeatMinutes: 4, placement: "pot" },
  { id: "scallop", section: "premium", customerName: "丸ごとホタテ1個", kitchenName: "冷凍ホタテ", quantity: "1個", placement: "pot" },
  { id: "squid-ring", section: "premium", customerName: "ヤリイカ", aliases: ["イカリング 50g"], kitchenName: "冷凍ヤリイカ", quantity: "50g", placement: "pot" },
  { id: "camembert", section: "premium", customerName: "丸ごとカマンベール", kitchenName: "カマンベール", quantity: "1個", prep: "袋を取る", action: "そのまま入れる", placement: "pot" },
  { id: "clam", section: "premium", customerName: "たっぷりあさり", kitchenName: "冷凍あさり", quantity: "70g", placement: "pot" },

  { id: "oyster", section: "vip", customerName: "広島県産大粒牡蠣", aliases: ["広島県産牡蠣 3個"], kitchenName: "冷凍牡蠣", quantity: "3個", placement: "pot" },
  { id: "seafood-set", section: "vip", customerName: "特選海鮮3種盛り", kitchenName: "大海老2個、ホタテ1個、ヤリイカ50g", quantity: "1セット", placement: "pot" },
  { id: "frankfurt", section: "vip", customerName: "糸島豚の特大フランクフルト1本", kitchenName: "冷凍特大フランクフルト", quantity: "1本", minimumHeatMinutes: 5, placement: "pot" },
  { id: "stem-lettuce", section: "request", customerName: "山クラゲ", kitchenName: "乾燥山クラゲ", quantity: "6.5-7g", prep: "水で洗う", minimumHeatMinutes: 3, placement: "pot" },
];

export const maamaaSeasoningRules: MaamaaSeasoningRule[] = [
  { name: "普通辛", lines: ["追加なし"] },
  { name: "中辛", lines: ["鬼辛ペースト 3g"] },
  { name: "大辛", lines: ["鬼辛ペースト 5g", "ラー油 1g"] },
  { name: "激辛", lines: ["鬼辛ペースト 7g", "ラー油 1g"] },
  { name: "鬼の一歩手前", lines: ["鬼辛ペースト 10g", "ラー油 1g", "粗びき唐辛子 スプーン0.5"] },
  { name: "修羅の道", lines: ["鬼辛ペースト 15g", "ラー油 1g", "粗びき唐辛子 スプーン1杯"] },
  { name: "地獄の業火", lines: ["鬼辛ペースト 25g", "ラー油 1g", "粗びき唐辛子 山盛り1杯"] },
  { name: "味変", lines: ["発酵豆腐タレ 6g", "サーチャージャン 7g", "薬膳スパイス追加: 朝天麻辣鍋底醤 5g、五香粉 4ふり", "にんにくマシマシ 12g", "香酢: タレビンに香酢25g、じゃがりんたん酢5g"] },
];

export const maamaaSetRules: MaamaaSetRule[] = [
  {
    name: "セットメニュー共通",
    defaultItems: ["黒キクラゲ", "根菜", "キノコ類", "板春雨50g", "チンゲン菜"],
    notes: "セットメニューで追加トッピングがない場合も、壁のセット具材を必ず入れる。"
  },
  {
    name: "豚肉マーラータン",
    defaultItems: ["黒キクラゲ", "チンゲン菜", "キノコ類", "さつまいも2枚", "豚肉80g", "板春雨50g"],
    notes: "麺変更時は板春雨50gを置き換える。板春雨追加はさらに50g追加。"
  },
  {
    name: "複数杯注文",
    defaultItems: ["伝票を1オーダーずつ切る", "白い袋にそれぞれテープで貼る", "水を1袋に1個入れる", "スープアレンジの順番を端末表示と照合する"],
    notes: "端末と伝票でスープアレンジの順番が逆になることがあるため注意。"
  }
];

export function findMaamaaProductionRule(label: string) {
  const normalizedLabel = normalize(label.replace(/^トッピング[:：]/, ""));
  return maamaaProductionRules.find((rule) => {
    const names = [rule.customerName, rule.kitchenName, rule.id ?? "", ...(rule.aliases ?? [])].filter(Boolean).map(normalize);
    return names.some((name) => normalizedLabel === name || normalizedLabel.includes(name) || name.includes(normalizedLabel));
  });
}

export function formatMaamaaProductionRule(rule: MaamaaProductionRule, count = 1) {
  const quantity = rule.quantity ? `${rule.quantity}${count > 1 ? ` x${count}` : ""}` : count > 1 ? `x${count}` : "";
  const parts = [rule.kitchenName, quantity].filter(Boolean);
  const details = [
    rule.prep,
    rule.action,
    rule.minimumHeatMinutes ? `最低${rule.minimumHeatMinutes}分加熱` : "",
    rule.placement === "container" ? "容器に入れる" : "",
    rule.notes
  ].filter(Boolean);
  return details.length ? `${parts.join(" ")}（${details.join(" / ")}）` : parts.join(" ");
}

export function maamaaProductionReferenceSections() {
  const sectionLabels: Record<MaamaaProductionRule["section"], string> = {
    noodles: "麺の種類",
    base: "ベーシックトッピング",
    standard: "スタンダードトッピング",
    premium: "プレミアムトッピング",
    vip: "VIPトッピング",
    request: "リクエスト制トッピング",
    seasoning: "辛さ・味変",
    set: "セットメニュー",
    operation: "オペレーション"
  };
  return Object.entries(sectionLabels)
    .map(([section, title]) => ({
      id: section,
      title,
      rules: maamaaProductionRules.filter((rule) => rule.section === section)
    }))
    .filter((section) => section.rules.length);
}
