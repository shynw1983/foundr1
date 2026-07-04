export type MaamaaProductionRule = {
  id?: string;
  customerName: string;
  aliases?: string[];
  menuEntryKey?: string;
  menuEntryName?: string;
  productId?: string;
  productName?: string;
  section: "noodles" | "base" | "standard" | "premium" | "vip" | "request" | "seasoning" | "set" | "operation";
  kitchenName: string;
  cookType?: "boil" | "no_boil";
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

export type MaamaaSetItem = {
  productId?: string;
  productName: string;
  quantity?: string;
  unit?: string;
  note?: string;
};

export type MaamaaSetRule = {
  name: string;
  defaultItems: string[];
  items?: MaamaaSetItem[];
  notes?: string;
};

export type MaamaaReferenceLanguage = "ja" | "zh";

export type MaamaaProductionReferenceSettings = {
  productionRules: MaamaaProductionRule[];
  seasoningRules: MaamaaSeasoningRule[];
  setRules: MaamaaSetRule[];
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

const menuListedNeedsConfirmation = "メニュー掲載。厨房分量/処理は要確認。";
const menuListedDrinkNeedsConfirmation = "メニュー掲載。厨房提供ルールは要確認。";

export const maamaaProductionRules: MaamaaProductionRule[] = [
  { id: "wide-harusame", section: "noodles", customerName: "もちもち板春雨", kitchenName: "板春雨", quantity: "50g", prep: "2時間水につける", action: "麺変更時はデフォルト板春雨の置き換え。板春雨追加は別途50g追加。", placement: "pot" },
  { id: "wide-harusame-extra", section: "noodles", customerName: "板春雨追加", kitchenName: "板春雨", quantity: "追加50g", prep: "2時間水につける", action: "元々の板春雨50gに追加する", placement: "pot" },
  { id: "beef-noodle", section: "noodles", customerName: "牛筋麺", kitchenName: "牛筋麺", quantity: "50g", prep: "4時間水につける", action: "麺変更時はデフォルト板春雨の置き換え", placement: "pot" },
  { id: "harusame", section: "noodles", customerName: "春雨", kitchenName: "春雨", quantity: "40g", action: "加熱せず、容器に入れる", placement: "container" },
  { id: "tteokbokki", section: "noodles", customerName: "トッポッキ", kitchenName: "トッポッキ", quantity: "50g", placement: "pot" },
  { id: "sweet-potato-noodle", section: "noodles", customerName: "さつまいも麺", kitchenName: "さつまいも麺", quantity: "50g", placement: "pot" },
  { id: "kishimen", section: "noodles", customerName: "きしめん", aliases: ["【もっちりつるん】きしめん"], kitchenName: "きしめん", quantity: "50g", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "raw-mochi-noodle", section: "noodles", customerName: "生もち玉しめん", kitchenName: "生もち玉しめん", quantity: "50g", action: "完全に1分ほどで火が通るため加熱しすぎ注意", placement: "pot", notes: "写真転記。販売名は要確認。" },

  { id: "squid-ball", section: "base", customerName: "特選イカ団子1個", kitchenName: "冷凍イカ団子", quantity: "1個", minimumHeatMinutes: 5, placement: "pot" },
  { id: "beef-ball", section: "base", customerName: "特選牛肉団子1個", kitchenName: "冷凍牛肉団子", quantity: "1個", minimumHeatMinutes: 5, placement: "pot" },
  { id: "pork-ball", section: "base", customerName: "特選豚団子1個", kitchenName: "特選豚団子", quantity: "1個", minimumHeatMinutes: 5, placement: "pot" },
  { id: "wonton", section: "base", customerName: "特製ワンタン1個", kitchenName: "ワンタン", quantity: "1個", minimumHeatMinutes: 2, placement: "pot" },
  { id: "quail-egg", section: "base", customerName: "うずらの卵1個", kitchenName: "うずらの卵", quantity: "1個", placement: "pot" },
  { id: "tofu-skin", section: "base", customerName: "火鍋豆皮", kitchenName: "乾燥火鍋豆皮", quantity: "1枚", prep: "水で洗う", minimumHeatMinutes: 5, placement: "pot" },
  { id: "fresh-yuba", section: "base", customerName: "生腐竹", kitchenName: "生腐竹", quantity: "50g", placement: "pot", notes: "店内表記と実物を要確認" },
  { id: "old-tofu-skin", section: "base", customerName: "老豆皮1枚", aliases: ["【大サイズ】老豆皮1枚"], kitchenName: "老豆皮", quantity: "1枚", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "knotted-yuba", section: "base", customerName: "結びゆば1個", kitchenName: "冷凍結びゆば", quantity: "1個", minimumHeatMinutes: 2, placement: "pot" },
  { id: "crab-ball", section: "base", customerName: "魚卵入り蟹団子1個", kitchenName: "冷凍蟹団子", quantity: "1個", minimumHeatMinutes: 3, placement: "pot" },
  { id: "hanamidori-tsukune", section: "base", customerName: "華味鳥つくね1個", kitchenName: "華味鳥つくね", quantity: "1個", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "shrimp-ball", section: "base", customerName: "特選えび団子1個", kitchenName: "特選えび団子", quantity: "1個", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "spinach-shrimp-dumpling", section: "base", customerName: "ほうれん草えび餃子1個", kitchenName: "ほうれん草えび餃子", quantity: "1個", placement: "pot", notes: menuListedNeedsConfirmation },

  { id: "bok-choy", section: "standard", customerName: "チンゲン菜", kitchenName: "チンゲン菜", quantity: "40g", prep: "水でさっと洗う", placement: "pot" },
  { id: "broccoli", section: "standard", customerName: "ブロッコリー", kitchenName: "冷凍ブロッコリー", quantity: "50g", placement: "pot" },
  { id: "duck-blood", section: "standard", customerName: "鴨の血1枚", kitchenName: "冷凍鴨の血", quantity: "1枚", placement: "pot" },
  { id: "sausage", section: "standard", customerName: "ウインナー1個", kitchenName: "ウインナー", quantity: "1個", placement: "pot" },
  { id: "kanikama", section: "standard", customerName: "カニカマ", kitchenName: "冷凍カニカマ", quantity: "50g", placement: "pot" },
  { id: "dried-tofu", section: "standard", customerName: "干し豆腐", kitchenName: "干し豆腐", quantity: "1個", action: "乾燥したまま鍋に入れる", placement: "pot" },
  { id: "garlic", section: "standard", customerName: "にんにく1粒", kitchenName: "冷凍にんにく", quantity: "1個", placement: "pot" },
  { id: "tomato", section: "standard", customerName: "プチトマト1個", aliases: ["国産プチトマト1個"], kitchenName: "プチトマト", quantity: "1個", prep: "ヘタを取る", placement: "pot" },
  { id: "wakame", section: "standard", customerName: "わかめ", kitchenName: "乾燥わかめ", quantity: "5g", action: "乾燥したまま容器に入れる", placement: "container" },
  { id: "pork-tongue", section: "premium", customerName: "豚タン", aliases: ["国産 豚タン 約50g", "【国産】豚タン約50g"], kitchenName: "冷凍豚タン", quantity: "50g", action: "鍋に入れたあとよくほぐす", placement: "pot" },
  { id: "nira", section: "standard", customerName: "ニラ", kitchenName: "ニラ", quantity: "30g", prep: "3-4cmに切る", placement: "pot" },
  { id: "okra", section: "standard", customerName: "オクラ1本", kitchenName: "冷凍オクラ", quantity: "1本", placement: "pot" },
  { id: "asparagus", section: "standard", customerName: "グリーンアスパラガス1本", kitchenName: "冷凍グリーンアスパラガス", quantity: "1本", placement: "pot" },
  { id: "cabbage", section: "standard", customerName: "キャベツ", kitchenName: "キャベツ", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "potato", section: "standard", customerName: "じゃがいも", kitchenName: "カットじゃがいも", quantity: "50g", notes: "常温がない時は冷凍を使う", placement: "pot" },
  { id: "sweet-potato", section: "standard", customerName: "さつまいも", kitchenName: "カットさつまいも", quantity: "50g", notes: "常温がない時は冷凍を使う", placement: "pot" },
  { id: "enoki", section: "standard", customerName: "えのき", kitchenName: "えのき", quantity: "40g", placement: "pot" },
  { id: "shimeji", section: "standard", customerName: "しめじ", kitchenName: "しめじ", quantity: "40g", placement: "pot" },
  { id: "eringi", section: "standard", customerName: "エリンギ", kitchenName: "エリンギ", quantity: "40g", placement: "pot" },
  { id: "shiitake", section: "standard", customerName: "しいたけ", kitchenName: "しいたけ", placement: "pot", notes: "メニュー掲載。セット写真では1ヶ。単品分量/処理は要確認。" },
  { id: "wood-ear", section: "standard", customerName: "黒キクラゲ", kitchenName: "黒キクラゲ", quantity: "7個くらい", prep: "水で洗う", placement: "pot" },
  { id: "white-wood-ear", section: "standard", customerName: "白きくらげ", kitchenName: "白きくらげ", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "white-negi", section: "standard", customerName: "白ネギ", kitchenName: "白ネギ", quantity: "50g", prep: "白いところを3-4cmに切る", placement: "pot" },
  { id: "spam", section: "standard", customerName: "スパム1枚", kitchenName: "冷凍スパム", quantity: "1枚", placement: "pot" },
  { id: "hakusai", section: "standard", customerName: "白菜", kitchenName: "白菜", quantity: "50g", placement: "pot" },
  { id: "pumpkin", section: "standard", customerName: "かぼちゃ", kitchenName: "冷凍かぼちゃ", quantity: "50g", placement: "pot" },
  { id: "tofu", section: "standard", customerName: "豆腐", kitchenName: "豆腐", quantity: "1パック", prep: "4等分にカットして全部入れる", placement: "pot" },
  { id: "coriander", section: "standard", customerName: "パクチー", kitchenName: "パクチー", placement: "finish", notes: "メニュー掲載。セット写真ではパクチーマーラータンに30g。単品分量/処理は要確認。" },
  { id: "baby-corn", section: "standard", customerName: "ベビーコーン1本", kitchenName: "ベビーコーン", quantity: "1本", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "lotus-root", section: "standard", customerName: "れんこん1個", kitchenName: "れんこん", quantity: "1個", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "pea-sprout", section: "standard", customerName: "豆苗", kitchenName: "豆苗", placement: "pot", notes: "メニュー掲載。野菜セット写真では20g。単品分量/処理は要確認。" },
  { id: "satoimo", section: "standard", customerName: "里芋1個", kitchenName: "里芋", quantity: "1個", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "hime-takenoko", section: "standard", customerName: "姫たけのこ1本", kitchenName: "姫たけのこ", quantity: "1本", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "beef-slice-standard", section: "standard", customerName: "牛肉スライス 50g", kitchenName: "牛肉スライス", quantity: "50g", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "mochi", section: "standard", customerName: "国産もち1個", kitchenName: "国産もち", quantity: "1個", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "spinach", section: "standard", customerName: "ほうれん草", kitchenName: "ほうれん草", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "eggplant", section: "standard", customerName: "茄子", kitchenName: "茄子", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "celery", section: "standard", customerName: "セロリ", kitchenName: "セロリ", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "mini-hamburg", section: "standard", customerName: "ミニハンバーグ1個", kitchenName: "ミニハンバーグ", quantity: "1個", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "shishamo", section: "standard", customerName: "子持ちししゃも一匹", aliases: ["【ぷちぷち】子持ちししゃも一匹"], kitchenName: "子持ちししゃも", quantity: "1匹", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "carrot", section: "standard", customerName: "人参", kitchenName: "人参", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "lettuce", section: "standard", customerName: "レタス", kitchenName: "レタス", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "kaiware", section: "standard", customerName: "カイワレ", kitchenName: "カイワレ", placement: "finish", notes: menuListedNeedsConfirmation },

  { id: "beef-suji", section: "premium", customerName: "とろとろ牛すじ", aliases: ["国産牛すじ 50g"], kitchenName: "冷凍小分け牛すじ", quantity: "50g 1袋", placement: "pot" },
  { id: "pork-cartilage", section: "premium", customerName: "とろとろ豚軟骨", aliases: ["国産豚軟骨 50g"], kitchenName: "冷凍小分け豚軟骨", quantity: "50g 1袋", placement: "pot" },
  { id: "pork-head", section: "premium", customerName: "厳選国産豚肉スライス", aliases: ["国産豚肉スライス", "豚肉スライス", "【厳選】豚肉スライス(1人前約50g)"], kitchenName: "冷凍豚あたまスライス", quantity: "50g", placement: "pot" },
  { id: "lamb", section: "premium", customerName: "厳選ラム肉", aliases: ["高級NZ羊ラム 50g", "【高級NZ羊】厳選ラム肉(1人前約50g)"], kitchenName: "冷凍ラム肉", quantity: "50g", action: "鍋に入れたあとこまめにほぐす", placement: "pot" },
  { id: "pork-offal", section: "premium", customerName: "ぷりぷり国産牛モツ", aliases: ["国産牛モツ 50g"], kitchenName: "冷凍小分け牛モツ", quantity: "50g 1袋", placement: "pot" },
  { id: "large-shrimp", section: "premium", customerName: "大えび一匹", kitchenName: "冷凍ブラックタイガー", quantity: "1匹", minimumHeatMinutes: 4, placement: "pot" },
  { id: "scallop", section: "premium", customerName: "丸ごとホタテ1個", kitchenName: "冷凍ホタテ", quantity: "1個", placement: "pot" },
  { id: "squid-ring", section: "premium", customerName: "ヤリイカ", aliases: ["イカリング 50g"], kitchenName: "冷凍ヤリイカ", quantity: "50g", placement: "pot" },
  { id: "camembert", section: "premium", customerName: "丸ごとカマンベール", kitchenName: "カマンベール", quantity: "1個", prep: "袋を取る", action: "そのまま入れる", placement: "pot" },
  { id: "clam", section: "premium", customerName: "たっぷりあさり", kitchenName: "冷凍あさり", quantity: "70g", placement: "pot" },
  { id: "white-fish", section: "premium", customerName: "白身魚", kitchenName: "白身魚", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "chicken-breast", section: "premium", customerName: "国産とりむねスライス 50g", kitchenName: "国産とりむねスライス", quantity: "50g", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "pork-liver", section: "premium", customerName: "国産豚レバー 50g", aliases: ["【スタミナ】国産豚レバー(1人前約50g)"], kitchenName: "国産豚レバー", quantity: "50g", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "octopus", section: "premium", customerName: "ぶつ切りたこ 50g", kitchenName: "ぶつ切りたこ", quantity: "50g", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "iidako", section: "premium", customerName: "丸ごとイイダコ1匹", aliases: ["【李司令】丸ごとイイダコ1匹"], kitchenName: "丸ごとイイダコ", quantity: "1匹", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "beef-omasum", section: "premium", customerName: "牛赤センマイ", aliases: ["【数量限定品】牛赤センマイ(約50g)"], kitchenName: "牛赤センマイ", quantity: "50g", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "beef-mochicho", section: "premium", customerName: "牛もちちょう", aliases: ["【数量限定品】牛もちちょう(約50g)"], kitchenName: "牛もちちょう", quantity: "50g", placement: "pot", notes: menuListedNeedsConfirmation },

  { id: "oyster", section: "vip", customerName: "広島県産大粒牡蠣", aliases: ["広島県産牡蠣 3個"], kitchenName: "冷凍牡蠣", quantity: "3個", placement: "pot" },
  { id: "seafood-set", section: "vip", customerName: "特選海鮮3種盛り", kitchenName: "大海老2個、ホタテ1個、ヤリイカ50g", quantity: "1セット", placement: "pot" },
  { id: "frankfurt", section: "vip", customerName: "糸島豚の特大フランクフルト1本", kitchenName: "冷凍特大フランクフルト", quantity: "1本", minimumHeatMinutes: 5, placement: "pot" },
  { id: "mozzarella", section: "vip", customerName: "丸ごとモッツァレラ1個", kitchenName: "丸ごとモッツァレラ", quantity: "1個", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "stem-lettuce", section: "request", customerName: "山クラゲ", kitchenName: "乾燥山クラゲ", quantity: "6.5-8g", prep: "水で洗う", minimumHeatMinutes: 3, placement: "pot", notes: "テキストは6.5-7g、壁写真は8g。要確認。" },
  { id: "bunmoja", section: "request", customerName: "ブンモジャ1本", kitchenName: "ブンモジャ", quantity: "1本", placement: "pot", notes: menuListedNeedsConfirmation },
  { id: "cola-shot", section: "request", customerName: "コーラ1ショット", kitchenName: "コーラ", quantity: "1ショット", placement: "finish", notes: menuListedDrinkNeedsConfirmation },
];

export const maamaaSeasoningRules: MaamaaSeasoningRule[] = [
  { name: "旨味マーラータンスープ", lines: ["ベーススープ。分量/注ぎ方は店内ルールを要確認"] },
  { name: "薬膳スパイスあり", lines: ["メニュー掲載。標準投入か追加扱いか要確認"] },
  { name: "薬膳スパイスなし", lines: ["メニュー掲載。薬膳スパイスを入れない"] },
  { name: "普通辛", lines: ["追加なし"] },
  { name: "中辛", lines: ["鬼辛ペースト 3g"] },
  { name: "大辛", lines: ["鬼辛ペースト 5g", "ラー油 1g"] },
  { name: "激辛", lines: ["鬼辛ペースト 7g", "ラー油 1g"] },
  { name: "鬼の一歩手前", lines: ["鬼辛ペースト 10g", "ラー油 1g", "粗びき唐辛子 スプーン0.5"] },
  { name: "修羅の道", lines: ["鬼辛ペースト 15g", "ラー油 1g", "粗びき唐辛子 スプーン1杯"] },
  { name: "地獄の業火", lines: ["鬼辛ペースト 25g", "ラー油 1g", "粗びき唐辛子 山盛り1杯"] },
  { name: "微シビ", lines: [menuListedNeedsConfirmation] },
  { name: "ちょいシビ", lines: [menuListedNeedsConfirmation] },
  { name: "シビレ", lines: [menuListedNeedsConfirmation] },
  { name: "ビリリ", lines: [menuListedNeedsConfirmation] },
  { name: "ビリビリ", lines: [menuListedNeedsConfirmation] },
  { name: "香酢", lines: ["タレビンに香酢25g、じゃがりんたん酢5g"] },
  { name: "サーチャージャン / 沙茶醤", lines: ["サーチャージャン 7g"] },
  { name: "発酵豆腐タレ", lines: ["発酵豆腐タレ 6g"] },
  { name: "薬膳スパイス追加", lines: ["朝天麻辣鍋底醤 5g", "五香粉 4ふり"] },
  { name: "にんにくマシマシ", lines: ["にんにく 12g"] },
  { name: "味変", lines: ["発酵豆腐タレ 6g", "サーチャージャン 7g", "薬膳スパイス追加: 朝天麻辣鍋底醤 5g、五香粉 4ふり", "にんにくマシマシ 12g", "香酢: タレビンに香酢25g、じゃがりんたん酢5g"] },
];

const standardMeatSetBase = [
  "黒キクラゲ5g",
  "板春雨50g",
  "さつまいも1ヶ",
  "じゃがいも1ヶ",
  "しいたけ1ヶ",
  "エリンギ2ヶ",
  "えのき30g",
  "しめじ30g",
  "チンゲン菜30g"
];

const vegetableSetBase = [
  "黒キクラゲ5g",
  "板春雨50g",
  "さつまいも1ヶ",
  "じゃがいも2ヶ",
  "かぼちゃ2ヶ",
  "ブロッコリー2ヶ",
  "プチトマト1ヶ",
  "白ネギ3ヶ",
  "豆苗20g",
  "チンゲン菜20g",
  "しいたけ1ヶ",
  "エリンギ2ヶ",
  "えのき30g",
  "しめじ30g"
];

export const maamaaSetRules: MaamaaSetRule[] = [
  {
    name: "セットメニュー共通",
    defaultItems: ["黒キクラゲ", "根菜", "キノコ類", "板春雨50g", "チンゲン菜"],
    notes: "セットメニューで追加トッピングがない場合も、壁のセット具材を必ず入れる。下の個別套餐は壁写真から読める範囲で転記。"
  },
  {
    name: "野菜マーラータン",
    defaultItems: vegetableSetBase,
    notes: "壁写真転記。野菜量は写真の数字を優先。"
  },
  {
    name: "豚肉マーラータン",
    defaultItems: ["豚肉80g", ...standardMeatSetBase],
    notes: "壁写真はさつまいも1ヶ。ユーザーメモ例はさつまいも2枚のため要確認。"
  },
  {
    name: "牛肉マーラータン",
    defaultItems: ["牛肉80g", ...standardMeatSetBase],
    notes: "壁写真転記。"
  },
  {
    name: "ラムマーラータン",
    defaultItems: ["ラム肉80g", ...standardMeatSetBase],
    notes: "壁写真転記。"
  },
  {
    name: "とろとろ国産牛すじのマーラータン",
    defaultItems: ["牛すじ80g", ...standardMeatSetBase],
    notes: "壁写真転記。"
  },
  {
    name: "パクチーマーラータン",
    defaultItems: ["黒キクラゲ5g", "かに団子1ヶ", "イカ団子1ヶ", "牛肉団子1ヶ", "板春雨50g", "さつまいも1ヶ", "じゃがいも1ヶ", "しいたけ1ヶ", "エリンギ2ヶ", "えのき30g", "しめじ30g", "パクチー30g"],
    notes: "壁写真転記。"
  },
  {
    name: "3種の海鮮マーラータン",
    defaultItems: ["黒キクラゲ5g", "板春雨50g", "大えび1ヶ", "ヤリイカ40-50g", "ホタテ1ヶ", "さつまいも1ヶ", "じゃがいも1ヶ", "しいたけ1ヶ", "エリンギ2ヶ", "えのき30g", "しめじ30g", "チンゲン菜30g"],
    notes: "壁写真転記。メニュー上の特選海鮮3種盛りと海老数が異なる可能性があるため要確認。"
  },
  {
    name: "丸ごとカマンベールのマーラータン",
    defaultItems: ["黒キクラゲ5g", "板春雨50g", "カマンベールチーズ1ヶ", "しいたけ1ヶ", "エリンギ2ヶ", "しめじ30g", "えのき30g", "さつまいも1ヶ", "じゃがいも1ヶ", "チンゲン菜30g"],
    notes: "壁写真転記。"
  },
  {
    name: "極上の肉マーラータン",
    defaultItems: ["黒キクラゲ5g", "板春雨50g", "さつまいも1ヶ", "じゃがいも1ヶ", "しいたけ1ヶ", "エリンギ2ヶ", "えのき30g", "しめじ30g", "チンゲン菜30g", "黒毛和牛100g"],
    notes: "スープ投入後2-3分ほどたったら、自然解凍した黒毛和牛100gをしゃぶしゃぶする。盛り付け時は大きな和牛が一番上に来るようにする。"
  },
  {
    name: "複数杯注文",
    defaultItems: ["伝票を1オーダーずつ切る", "白い袋にそれぞれテープで貼る", "水を1袋に1個入れる", "スープアレンジの順番を端末表示と照合する"],
    notes: "端末と伝票でスープアレンジの順番が逆になることがあるため注意。"
  }
];

const maamaaZhExactText: Record<string, string> = {
  "麺の種類": "面类",
  "ベーシックトッピング": "基础加料",
  "スタンダードトッピング": "标准加料",
  "プレミアムトッピング": "高级加料",
  "VIPトッピング": "VIP 加料",
  "リクエスト制トッピング": "按需加料",
  "辛さ・味変": "辣度 / 调味",
  "セットメニュー": "套餐",
  "オペレーション": "操作注意",
  "もちもち板春雨": "Q弹宽粉",
  "板春雨追加": "追加宽粉",
  "板春雨": "宽粉",
  "牛筋麺": "牛筋面",
  "春雨": "粉丝",
  "トッポッキ": "年糕条",
  "さつまいも麺": "红薯粉",
  "きしめん": "宽扁面",
  "生もち玉しめん": "生年糕玉面",
  "特選イカ団子1個": "特选鱿鱼丸1个",
  "冷凍イカ団子": "冷冻鱿鱼丸",
  "特選牛肉団子1個": "特选牛肉丸1个",
  "冷凍牛肉団子": "冷冻牛肉丸",
  "特選豚団子1個": "特选猪肉丸1个",
  "特選豚団子": "特选猪肉丸",
  "特製ワンタン1個": "特制馄饨1个",
  "ワンタン": "馄饨",
  "うずらの卵1個": "鹌鹑蛋1个",
  "うずらの卵": "鹌鹑蛋",
  "火鍋豆皮": "火锅豆皮",
  "乾燥火鍋豆皮": "干火锅豆皮",
  "生腐竹": "鲜腐竹",
  "老豆皮1枚": "老豆皮1张",
  "老豆皮": "老豆皮",
  "結びゆば1個": "豆皮结1个",
  "冷凍結びゆば": "冷冻豆皮结",
  "魚卵入り蟹団子1個": "鱼籽蟹柳丸1个",
  "冷凍蟹団子": "冷冻蟹丸",
  "華味鳥つくね1個": "华味鸟鸡肉丸1个",
  "華味鳥つくね": "华味鸟鸡肉丸",
  "特選えび団子1個": "特选虾丸1个",
  "特選えび団子": "特选虾丸",
  "ほうれん草えび餃子1個": "菠菜虾饺1个",
  "ほうれん草えび餃子": "菠菜虾饺",
  "チンゲン菜": "青梗菜",
  "ブロッコリー": "西兰花",
  "冷凍ブロッコリー": "冷冻西兰花",
  "鴨の血1枚": "鸭血1片",
  "冷凍鴨の血": "冷冻鸭血",
  "ウインナー1個": "小香肠1个",
  "ウインナー": "小香肠",
  "カニカマ": "蟹味棒",
  "冷凍カニカマ": "冷冻蟹味棒",
  "干し豆腐": "干豆腐",
  "にんにく1粒": "蒜1粒",
  "冷凍にんにく": "冷冻蒜",
  "プチトマト1個": "小番茄1个",
  "プチトマト": "小番茄",
  "わかめ": "裙带菜",
  "乾燥わかめ": "干裙带菜",
  "豚タン": "猪舌",
  "冷凍豚タン": "冷冻猪舌",
  "ニラ": "韭菜",
  "オクラ1本": "秋葵1根",
  "冷凍オクラ": "冷冻秋葵",
  "グリーンアスパラガス1本": "绿芦笋1根",
  "冷凍グリーンアスパラガス": "冷冻绿芦笋",
  "キャベツ": "卷心菜",
  "じゃがいも": "土豆",
  "カットじゃがいも": "切块土豆",
  "さつまいも": "红薯",
  "カットさつまいも": "切块红薯",
  "えのき": "金针菇",
  "しめじ": "蟹味菇",
  "エリンギ": "杏鲍菇",
  "しいたけ": "香菇",
  "黒キクラゲ": "黑木耳",
  "白きくらげ": "银耳",
  "白ネギ": "大葱",
  "スパム1枚": "午餐肉1片",
  "冷凍スパム": "冷冻午餐肉",
  "白菜": "白菜",
  "かぼちゃ": "南瓜",
  "冷凍かぼちゃ": "冷冻南瓜",
  "豆腐": "豆腐",
  "パクチー": "香菜",
  "ベビーコーン1本": "玉米笋1根",
  "ベビーコーン": "玉米笋",
  "れんこん1個": "莲藕1个",
  "れんこん": "莲藕",
  "豆苗": "豆苗",
  "里芋1個": "芋头1个",
  "里芋": "芋头",
  "姫たけのこ1本": "姬竹笋1根",
  "姫たけのこ": "姬竹笋",
  "牛肉スライス 50g": "牛肉片50g",
  "牛肉スライス": "牛肉片",
  "国産もち1個": "国产年糕1个",
  "国産もち": "国产年糕",
  "ほうれん草": "菠菜",
  "茄子": "茄子",
  "セロリ": "芹菜",
  "ミニハンバーグ1個": "迷你汉堡肉1个",
  "ミニハンバーグ": "迷你汉堡肉",
  "子持ちししゃも一匹": "带籽柳叶鱼1条",
  "子持ちししゃも": "带籽柳叶鱼",
  "人参": "胡萝卜",
  "レタス": "生菜",
  "カイワレ": "萝卜苗",
  "とろとろ牛すじ": "软烂牛筋",
  "冷凍小分け牛すじ": "冷冻分装牛筋",
  "とろとろ豚軟骨": "软烂猪软骨",
  "冷凍小分け豚軟骨": "冷冻分装猪软骨",
  "厳選国産豚肉スライス": "严选国产猪肉片",
  "冷凍豚あたまスライス": "冷冻猪头肉片",
  "厳選ラム肉": "严选羊肉",
  "冷凍ラム肉": "冷冻羊肉",
  "ぷりぷり国産牛モツ": "弹牙国产牛杂",
  "冷凍小分け牛モツ": "冷冻分装牛杂",
  "大えび一匹": "大虾1只",
  "冷凍ブラックタイガー": "冷冻黑虎虾",
  "丸ごとホタテ1個": "整颗扇贝1个",
  "冷凍ホタテ": "冷冻扇贝",
  "ヤリイカ": "鱿鱼",
  "冷凍ヤリイカ": "冷冻鱿鱼",
  "丸ごとカマンベール": "整颗卡芒贝尔奶酪",
  "カマンベール": "卡芒贝尔奶酪",
  "たっぷりあさり": "足量蛤蜊",
  "冷凍あさり": "冷冻蛤蜊",
  "白身魚": "白身鱼",
  "国産とりむねスライス 50g": "国产鸡胸肉片50g",
  "国産とりむねスライス": "国产鸡胸肉片",
  "国産豚レバー 50g": "国产猪肝50g",
  "国産豚レバー": "国产猪肝",
  "ぶつ切りたこ 50g": "切块章鱼50g",
  "ぶつ切りたこ": "切块章鱼",
  "丸ごとイイダコ1匹": "整只饭蛸1只",
  "丸ごとイイダコ": "整只饭蛸",
  "牛赤センマイ": "牛红百叶",
  "牛もちちょう": "牛小肠",
  "広島県産大粒牡蠣": "广岛县产大粒牡蛎",
  "冷凍牡蠣": "冷冻牡蛎",
  "特選海鮮3種盛り": "特选海鲜三拼",
  "大海老2個、ホタテ1個、ヤリイカ50g": "大虾2只、扇贝1个、鱿鱼50g",
  "糸島豚の特大フランクフルト1本": "糸岛猪特大法兰克福香肠1根",
  "冷凍特大フランクフルト": "冷冻特大香肠",
  "丸ごとモッツァレラ1個": "整颗马苏里拉1个",
  "丸ごとモッツァレラ": "整颗马苏里拉",
  "山クラゲ": "山莴笋",
  "乾燥山クラゲ": "干山莴笋",
  "ブンモジャ1本": "粉耗子1根",
  "ブンモジャ": "粉耗子",
  "コーラ1ショット": "可乐1 shot",
  "コーラ": "可乐",
  "旨味マーラータンスープ": "鲜味麻辣烫汤底",
  "薬膳スパイスあり": "加药膳香料",
  "薬膳スパイスなし": "不加药膳香料",
  "普通辛": "普通辣",
  "中辛": "中辣",
  "大辛": "大辣",
  "激辛": "特辣",
  "鬼の一歩手前": "鬼辣前一步",
  "修羅の道": "修罗之道",
  "地獄の業火": "地狱业火",
  "微シビ": "微麻",
  "ちょいシビ": "小麻",
  "シビレ": "麻",
  "ビリリ": "较麻",
  "ビリビリ": "很麻",
  "香酢": "香醋",
  "サーチャージャン / 沙茶醤": "沙茶酱",
  "発酵豆腐タレ": "腐乳酱",
  "薬膳スパイス追加": "追加药膳香料",
  "にんにくマシマシ": "加倍蒜",
  "味変": "调味",
  "セットメニュー共通": "套餐通用",
  "野菜マーラータン": "蔬菜麻辣烫",
  "豚肉マーラータン": "猪肉麻辣烫",
  "牛肉マーラータン": "牛肉麻辣烫",
  "ラムマーラータン": "羊肉麻辣烫",
  "とろとろ国産牛すじのマーラータン": "软烂国产牛筋麻辣烫",
  "パクチーマーラータン": "香菜麻辣烫",
  "3種の海鮮マーラータン": "三种海鲜麻辣烫",
  "丸ごとカマンベールのマーラータン": "整颗卡芒贝尔麻辣烫",
  "極上の肉マーラータン": "极品肉麻辣烫",
  "複数杯注文": "多杯订单"
};

const maamaaZhPhraseReplacements: Array<[string, string]> = [
  ["メニュー掲載。厨房分量/処理は要確認。", "菜单已上架。厨房分量/处理方式需确认。"],
  ["メニュー掲載。厨房提供ルールは要確認。", "菜单已上架。厨房出品规则需确认。"],
  ["メニュー掲載。標準投入か追加扱いか要確認", "菜单已上架。需确认是标准加入还是追加项"],
  ["メニュー掲載。薬膳スパイスを入れない", "菜单已上架。不放药膳香料"],
  ["メニュー掲載。セット写真では", "菜单已上架。套餐照片中为"],
  ["単品分量/処理は要確認。", "单品分量/处理方式需确认。"],
  ["店内表記と実物を要確認", "需确认店内标识和实物"],
  ["写真転記。販売名は要確認。", "根据照片转记。销售名称需确认。"],
  ["壁写真転記。", "根据墙上照片转记。"],
  ["壁写真は", "墙上照片为"],
  ["ユーザーメモ例は", "用户备注示例为"],
  ["のため要確認。", "，因此需确认。"],
  ["野菜量は写真の数字を優先。", "蔬菜量以照片数字优先。"],
  ["メニュー上の特選海鮮3種盛りと海老数が異なる可能性があるため要確認。", "可能与菜单上的特选海鲜三拼虾数不同，需确认。"],
  ["テキストは", "文字版为"],
  ["壁写真は", "墙上照片为"],
  ["要確認。", "需确认。"],
  ["追加なし", "不追加"],
  ["ベーススープ。分量/注ぎ方は店内ルールを要確認", "基础汤底。分量/倒汤方式需按店内规则确认"],
  ["朝天麻辣鍋底醤", "朝天麻辣锅底酱"],
  ["五香粉", "五香粉"],
  ["鬼辛ペースト", "鬼辣酱"],
  ["ラー油", "辣油"],
  ["粗びき唐辛子", "粗辣椒粉"],
  ["スプーン", "勺"],
  ["山盛り", "满满"],
  ["タレビンに", "装入酱汁瓶："],
  ["じゃがりんたん酢", "じゃがりんたん醋"],
  ["発酵豆腐タレ", "腐乳酱"],
  ["サーチャージャン", "沙茶酱"],
  ["にんにくマシマシ", "加倍蒜"],
  ["水につける", "泡水"],
  ["水で洗う", "用水清洗"],
  ["水でさっと洗う", "快速用水清洗"],
  ["ヘタを取る", "去蒂"],
  ["袋を取る", "去掉包装"],
  ["そのまま入れる", "直接放入"],
  ["乾燥したまま鍋に入れる", "干燥状态直接放入锅中"],
  ["乾燥したまま容器に入れる", "干燥状态直接放入容器"],
  ["加熱せず、容器に入れる", "不需要加热，放入容器"],
  ["麺変更時はデフォルト板春雨の置き換え。板春雨追加は別途50g追加。", "更换面类时替换默认宽粉。追加宽粉则另加50g。"],
  ["麺変更時はデフォルト板春雨の置き換え", "更换面类时替换默认宽粉"],
  ["元々の板春雨50gに追加する", "在原本宽粉50g基础上追加"],
  ["完全に1分ほどで火が通るため加熱しすぎ注意", "约1分钟即可熟，注意不要加热过头"],
  ["鍋に入れたあとよくほぐす", "放入锅后充分拨散"],
  ["鍋に入れたあとこまめにほぐす", "放入锅后勤拨散"],
  ["白いところを3-4cmに切る", "取白色部分切成3-4cm"],
  ["3-4cmに切る", "切成3-4cm"],
  ["4等分にカットして全部入れる", "切成4等份后全部放入"],
  ["常温がない時は冷凍を使う", "没有常温时使用冷冻"],
  ["スープ投入後2-3分ほどたったら、自然解凍した黒毛和牛100gをしゃぶしゃぶする。盛り付け時は大きな和牛が一番上に来るようにする。", "倒入汤后约2-3分钟，将自然解冻的黑毛和牛100g涮熟。装盘时让大片和牛在最上面。"],
  ["セットメニューで追加トッピングがない場合も、壁のセット具材を必ず入れる。下の個別套餐は壁写真から読める範囲で転記。", "套餐即使没有追加加料，也必须放入墙上写的套餐基础食材。以下各套餐按墙上照片可读内容转记。"],
  ["伝票を1オーダーずつ切る", "把小票按每个订单剪开"],
  ["白い袋にそれぞれテープで貼る", "分别贴到白色袋子上"],
  ["水を1袋に1個入れる", "每个袋子放1瓶水"],
  ["スープアレンジの順番を端末表示と照合する", "核对汤底调整顺序和终端显示"],
  ["端末と伝票でスープアレンジの順番が逆になることがあるため注意。", "注意终端和小票上的汤底调整顺序可能相反。"],
  ["黒キクラゲ", "黑木耳"],
  ["根菜", "根菜类"],
  ["キノコ類", "菌菇类"],
  ["豚肉", "猪肉"],
  ["牛肉", "牛肉"],
  ["ラム肉", "羊肉"],
  ["牛すじ", "牛筋"],
  ["かに団子", "蟹丸"],
  ["イカ団子", "鱿鱼丸"],
  ["牛肉団子", "牛肉丸"],
  ["大えび", "大虾"],
  ["ホタテ", "扇贝"],
  ["カマンベールチーズ", "卡芒贝尔奶酪"],
  ["黒毛和牛", "黑毛和牛"],
  ["さつまいも", "红薯"],
  ["じゃがいも", "土豆"],
  ["しいたけ", "香菇"],
  ["エリンギ", "杏鲍菇"],
  ["えのき", "金针菇"],
  ["しめじ", "蟹味菇"],
  ["チンゲン菜", "青梗菜"],
  ["かぼちゃ", "南瓜"],
  ["ブロッコリー", "西兰花"],
  ["プチトマト", "小番茄"],
  ["白ネギ", "大葱"],
  ["豆苗", "豆苗"],
  ["パクチー", "香菜"],
  ["板春雨", "宽粉"],
  ["ヶ", "个"]
];

export function translateMaamaaReferenceText(value: string | undefined, language: MaamaaReferenceLanguage) {
  if (!value || language === "ja") return value ?? "";
  let translated = maamaaZhExactText[value] ?? value;
  for (const [from, to] of maamaaZhPhraseReplacements) {
    translated = translated.replaceAll(from, to);
  }
  return translated;
}

function cloneMaamaaSettings(settings: MaamaaProductionReferenceSettings): MaamaaProductionReferenceSettings {
  return {
    productionRules: settings.productionRules.map((rule) => ({ ...rule, aliases: [...(rule.aliases ?? [])] })),
    seasoningRules: settings.seasoningRules.map((rule) => ({ ...rule, lines: [...rule.lines] })),
    setRules: settings.setRules.map((rule) => ({ ...rule, defaultItems: [...rule.defaultItems], items: rule.items?.map((item) => ({ ...item })) }))
  };
}

function normalizeProductionSection(value: unknown): MaamaaProductionRule["section"] {
  const section = String(value ?? "");
  return ["noodles", "base", "standard", "premium", "vip", "request", "seasoning", "set", "operation"].includes(section)
    ? section as MaamaaProductionRule["section"]
    : "standard";
}

function normalizePlacement(value: unknown): MaamaaProductionRule["placement"] | undefined {
  const placement = String(value ?? "");
  return placement === "pot" || placement === "container" || placement === "finish" ? placement : undefined;
}

function normalizeCookType(value: unknown, placement?: MaamaaProductionRule["placement"]): MaamaaProductionRule["cookType"] {
  const cookType = String(value ?? "");
  if (cookType === "no_boil") return "no_boil";
  if (cookType === "boil") return "boil";
  return placement === "container" || placement === "finish" ? "no_boil" : "boil";
}

function normalizeReferenceLines(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  return String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function normalizeProductionRule(value: unknown): MaamaaProductionRule | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const customerName = String(source.customerName ?? "").trim();
  const kitchenName = String(source.kitchenName ?? "").trim();
  if (!customerName || !kitchenName) return null;
  const heatMinutes = Number(source.minimumHeatMinutes ?? 0);
  const placement = normalizePlacement(source.placement);
  return {
    id: String(source.id ?? "").trim() || undefined,
    customerName,
    aliases: Array.isArray(source.aliases) ? source.aliases.map((item) => String(item ?? "").trim()).filter(Boolean) : undefined,
    menuEntryKey: String(source.menuEntryKey ?? "").trim() || undefined,
    menuEntryName: String(source.menuEntryName ?? "").trim() || undefined,
    productId: String(source.productId ?? "").trim() || undefined,
    productName: String(source.productName ?? "").trim() || undefined,
    section: normalizeProductionSection(source.section),
    kitchenName,
    cookType: normalizeCookType(source.cookType, placement),
    quantity: String(source.quantity ?? "").trim() || undefined,
    prep: String(source.prep ?? "").trim() || undefined,
    action: String(source.action ?? "").trim() || undefined,
    minimumHeatMinutes: Number.isFinite(heatMinutes) && heatMinutes > 0 ? Math.round(heatMinutes) : undefined,
    placement,
    notes: String(source.notes ?? "").trim() || undefined
  };
}

function normalizeSeasoningRule(value: unknown): MaamaaSeasoningRule | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const name = String(source.name ?? "").trim();
  const lines = normalizeReferenceLines(source.lines);
  return name && lines.length ? { name, lines } : null;
}

export function formatMaamaaSetItem(item: MaamaaSetItem) {
  const quantity = [item.quantity, item.unit].filter(Boolean).join("");
  return [item.productName, quantity].filter(Boolean).join("");
}

function normalizeSetItem(value: unknown): MaamaaSetItem | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const productName = String(source.productName ?? "").trim();
  if (!productName) return null;
  return {
    productId: String(source.productId ?? "").trim() || undefined,
    productName,
    quantity: String(source.quantity ?? "").trim() || undefined,
    unit: String(source.unit ?? "").trim() || undefined,
    note: String(source.note ?? "").trim() || undefined
  };
}

function normalizeSetRule(value: unknown): MaamaaSetRule | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const name = String(source.name ?? "").trim();
  const items = Array.isArray(source.items)
    ? source.items.map(normalizeSetItem).filter((item): item is MaamaaSetItem => Boolean(item))
    : [];
  const defaultItems = normalizeReferenceLines(source.defaultItems);
  const normalizedDefaultItems = defaultItems.length ? defaultItems : items.map(formatMaamaaSetItem).filter(Boolean);
  return name && normalizedDefaultItems.length ? {
    name,
    defaultItems: normalizedDefaultItems,
    items: items.length ? items : undefined,
    notes: String(source.notes ?? "").trim() || undefined
  } : null;
}

export const defaultMaamaaProductionReferenceSettings: MaamaaProductionReferenceSettings = {
  productionRules: maamaaProductionRules,
  seasoningRules: maamaaSeasoningRules,
  setRules: maamaaSetRules
};

export function normalizeMaamaaProductionReferenceSettings(value: unknown): MaamaaProductionReferenceSettings {
  if (!value || typeof value !== "object") return cloneMaamaaSettings(defaultMaamaaProductionReferenceSettings);
  const source = value as Partial<MaamaaProductionReferenceSettings>;
  const defaultSettings = cloneMaamaaSettings(defaultMaamaaProductionReferenceSettings);
  const hasProductionRules = Array.isArray(source.productionRules);
  const hasSeasoningRules = Array.isArray(source.seasoningRules);
  const hasSetRules = Array.isArray(source.setRules);
  const productionRules = hasProductionRules
    ? (source.productionRules ?? []).map(normalizeProductionRule).filter((rule): rule is MaamaaProductionRule => Boolean(rule))
    : defaultSettings.productionRules;
  const seasoningRules = hasSeasoningRules
    ? (source.seasoningRules ?? []).map(normalizeSeasoningRule).filter((rule): rule is MaamaaSeasoningRule => Boolean(rule))
    : defaultSettings.seasoningRules;
  const setRules = hasSetRules
    ? (source.setRules ?? []).map(normalizeSetRule).filter((rule): rule is MaamaaSetRule => Boolean(rule))
    : defaultSettings.setRules;

  return {
    productionRules,
    seasoningRules,
    setRules
  };
}

export function findMaamaaProductionRule(label: string, rules = maamaaProductionRules) {
  const normalizedLabel = normalize(label.replace(/^トッピング[:：]/, ""));
  return rules.find((rule) => {
    const names = [rule.customerName, rule.kitchenName, rule.id ?? "", ...(rule.aliases ?? [])].filter(Boolean).map(normalize);
    return names.some((name) => normalizedLabel === name || normalizedLabel.includes(name) || name.includes(normalizedLabel));
  });
}

export function formatMaamaaProductionRule(rule: MaamaaProductionRule, count = 1) {
  const quantity = rule.quantity ? `${rule.quantity}${count > 1 ? ` x${count}` : ""}` : count > 1 ? `x${count}` : "";
  const parts = [rule.kitchenName, quantity].filter(Boolean);
  const cookType = rule.cookType ?? (rule.placement === "container" || rule.placement === "finish" ? "no_boil" : "boil");
  const details = [
    cookType === "no_boil" ? "加熱不要" : "要加熱",
    rule.prep,
    rule.action,
    cookType === "boil" && rule.minimumHeatMinutes ? `最低${rule.minimumHeatMinutes}分加熱` : "",
    rule.placement === "container" ? "容器に入れる" : "",
    rule.notes
  ].filter(Boolean);
  return details.length ? `${parts.join(" ")}（${details.join(" / ")}）` : parts.join(" ");
}

export function maamaaProductionReferenceSections(rules = maamaaProductionRules) {
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
      rules: rules.filter((rule) => rule.section === section)
    }))
    .filter((section) => section.rules.length);
}
