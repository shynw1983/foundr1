export const stores = [
  { name: "セントラル受取拠点", owner: "王 店長", brands: ["奈奈茶", "熱辣食堂"] },
  { name: "東口テイクアウト店", owner: "林 店長", brands: ["奈奈茶"] },
  { name: "南町クラウド店", owner: "陳 店長", brands: ["熱辣食堂"] }
];

export const brands = [
  { name: "奈奈茶", type: "ミルクティー" },
  { name: "熱辣食堂", type: "マーラータン" }
];

export const categories = ["食材", "包材", "消耗品", "清掃備品", "設備消耗品"];

export const products = [
  {
    name: "アッサム紅茶ベース",
    category: "食材",
    brand: "奈奈茶",
    unit: "袋",
    referencePrice: 128,
    mainSupplier: "南区調味料店",
    backupSupplier: "城北食材卸",
    specNote: "茶葉 500g、濃縮抽出向き",
    photoUrl: "",
    storageType: "常温"
  },
  {
    name: "700ml テイクアウトカップ",
    category: "包材",
    brand: "奈奈茶",
    unit: "箱",
    referencePrice: 168,
    mainSupplier: "東和包材",
    backupSupplier: "オンライン包材 A",
    specNote: "95 口径、透明、1 箱 1,000 個",
    photoUrl: "",
    storageType: "常温"
  },
  {
    name: "牛脂マーラー鍋ベース",
    category: "食材",
    brand: "熱辣食堂",
    unit: "箱",
    referencePrice: 285,
    mainSupplier: "南区調味料店",
    backupSupplier: "城北食材卸",
    specNote: "辛口ベース、1kg パック",
    photoUrl: "",
    storageType: "常温"
  },
  {
    name: "使い捨て食品手袋",
    category: "消耗品",
    brand: "奈奈茶 / 熱辣食堂",
    unit: "箱",
    referencePrice: 29,
    mainSupplier: "城北食材卸",
    backupSupplier: "近隣業務スーパー",
    specNote: "食品対応、S/M/L を店舗別に管理",
    photoUrl: "",
    storageType: "常温"
  },
  {
    name: "生乳",
    category: "食材",
    brand: "奈奈茶 / 熱辣食堂",
    unit: "本",
    referencePrice: 198,
    mainSupplier: "城北食材卸",
    backupSupplier: "近隣業務スーパー",
    specNote: "成分無調整 1L",
    photoUrl: "",
    storageType: "冷蔵"
  }
];

export const productBrandUsages = [
  {
    product: "生乳",
    brand: "奈奈茶",
    usage: "ミルクティー、フォーム、期間限定ドリンク",
    defaultOrderQuantity: "12 本",
    specNote: "成分無調整、1L",
    priority: "高"
  },
  {
    product: "生乳",
    brand: "熱辣食堂",
    usage: "辛味を抑えるセットドリンク、スープ調整",
    defaultOrderQuantity: "4 本",
    specNote: "奈奈茶と同じ規格を共用",
    priority: "中"
  },
  {
    product: "使い捨て食品手袋",
    brand: "奈奈茶",
    usage: "ドリンク仕込み、トッピング準備",
    defaultOrderQuantity: "3 箱",
    specNote: "食品対応 S/M",
    priority: "中"
  },
  {
    product: "使い捨て食品手袋",
    brand: "熱辣食堂",
    usage: "具材仕込み、盛り付け、清掃",
    defaultOrderQuantity: "5 箱",
    specNote: "食品対応 M/L",
    priority: "高"
  },
  {
    product: "700ml テイクアウトカップ",
    brand: "奈奈茶",
    usage: "大杯ドリンク",
    defaultOrderQuantity: "2 箱",
    specNote: "95 口径、透明",
    priority: "高"
  }
];

export const suppliers = [
  { name: "城北食材卸", category: "肉類 / 練り物 / 野菜", reliability: "安定", channelType: "実店舗", address: "", phone: "", contactPerson: "", businessHours: "", orderUrl: "" },
  { name: "東和包材", category: "カップ / 容器 / 袋", reliability: "時々欠品", channelType: "実店舗", address: "", phone: "", contactPerson: "", businessHours: "", orderUrl: "" },
  { name: "南区調味料店", category: "鍋ベース / 茶葉 / 調味料", reliability: "価格変動あり", channelType: "実店舗", address: "", phone: "", contactPerson: "", businessHours: "", orderUrl: "" },
  { name: "近隣業務スーパー", category: "緊急補充 / 汎用品", reliability: "即日対応", channelType: "チェーン店", address: "", phone: "", contactPerson: "", businessHours: "", orderUrl: "" },
  { name: "オンライン包材 A", category: "包材 / 予備在庫", reliability: "配送に 1-2 日", channelType: "ネットショップ", address: "", phone: "", contactPerson: "", businessHours: "", orderUrl: "" }
];

export const supplierLocations = [
  {
    supplier: "オンライン包材 A",
    locationName: "公式オンラインストア",
    type: "ネットショップ",
    area: "全国配送",
    hours: "24 時間注文",
    purchaseMethod: "配送",
    note: "急ぎではない包材の予備発注向き"
  },
  {
    supplier: "近隣業務スーパー",
    locationName: "東口店",
    type: "チェーン店",
    area: "東口テイクアウト店から徒歩 8 分",
    hours: "9:00-22:00",
    purchaseMethod: "店頭購入",
    note: "営業中の不足分を即日補充"
  },
  {
    supplier: "近隣業務スーパー",
    locationName: "南町店",
    type: "チェーン店",
    area: "南町クラウド店から車 10 分",
    hours: "9:00-21:00",
    purchaseMethod: "店頭購入",
    note: "冷蔵品と消耗品の緊急購入"
  },
  {
    supplier: "城北食材卸",
    locationName: "城北本店",
    type: "実店舗",
    area: "セントラル受取拠点近く",
    hours: "6:00-15:00",
    purchaseMethod: "店頭 / 配送",
    note: "朝のまとめ購入に利用"
  },
  {
    supplier: "東和包材",
    locationName: "倉庫受取窓口",
    type: "実店舗",
    area: "東区倉庫街",
    hours: "8:00-17:00",
    purchaseMethod: "店頭 / 配送",
    note: "箱単位の包材購入"
  }
];

export const orders = [
  {
    id: "PO-0523-001",
    store: "東口テイクアウト店",
    brand: "奈奈茶",
    deadline: "本日 16:00",
    items: 8,
    priority: "高",
    status: "購入待ち"
  },
  {
    id: "PO-0523-002",
    store: "南町クラウド店",
    brand: "熱辣食堂",
    deadline: "本日 18:30",
    items: 12,
    priority: "中",
    status: "一部購入済み"
  },
  {
    id: "PO-0523-003",
    store: "セントラル受取拠点",
    brand: "奈奈茶 / 熱辣食堂",
    deadline: "明日 10:00",
    items: 15,
    priority: "高",
    status: "一部購入済み"
  },
  {
    id: "PO-0522-006",
    store: "東口テイクアウト店",
    brand: "奈奈茶",
    deadline: "昨日 20:00",
    items: 5,
    priority: "低",
    status: "確認待ち"
  }
];

export const exceptions = [
  {
    id: "EX-001",
    product: "700ml テイクアウトカップ",
    type: "欠品",
    message: "東和包材は本日欠品。火曜午前に入荷予定のため、先に透明カップで代替可能。",
    store: "東口テイクアウト店",
    status: "店舗確認待ち"
  },
  {
    id: "EX-002",
    product: "牛脂マーラー鍋ベース",
    type: "価格異常",
    message: "現地価格が参考価格より 12% 上昇。異常価格として記録済み。",
    store: "南町クラウド店",
    status: "購入担当が対応中"
  },
  {
    id: "EX-003",
    product: "使い捨て食品手袋",
    type: "数量不足",
    message: "6 箱のみ購入。残り 4 箱は明日追加購入予定。",
    store: "セントラル受取拠点",
    status: "一部解決"
  }
];

export const priceSignals = [
  { product: "牛脂マーラー鍋ベース", supplier: "南区調味料店", changeRate: 12 },
  { product: "アッサム紅茶ベース", supplier: "城北食材卸", changeRate: 5 },
  { product: "700ml テイクアウトカップ", supplier: "東和包材", changeRate: -3 },
  { product: "生乳", supplier: "城北食材卸", changeRate: 9 }
];

export const productSupplierOptions = [
  {
    product: "アッサム紅茶ベース",
    options: [
      {
        supplier: "南区調味料店",
        role: "メイン",
        referencePrice: 128,
        minOrder: "1 袋",
        leadTime: "当日",
        note: "茶葉の通常購入先"
      },
      {
        supplier: "城北食材卸",
        role: "予備",
        referencePrice: 136,
        minOrder: "2 袋",
        leadTime: "翌日",
        note: "メイン欠品時に利用"
      }
    ]
  },
  {
    product: "700ml テイクアウトカップ",
    options: [
      {
        supplier: "東和包材",
        role: "メイン",
        referencePrice: 168,
        minOrder: "1 箱",
        leadTime: "当日",
        note: "通常はこちらを優先"
      },
      {
        supplier: "オンライン包材 A",
        role: "予備",
        referencePrice: 182,
        minOrder: "2 箱",
        leadTime: "1-2 日",
        note: "欠品時のバックアップ"
      },
      {
        supplier: "近隣業務スーパー",
        role: "緊急",
        referencePrice: 210,
        minOrder: "1 箱",
        leadTime: "即日",
        note: "営業に影響する時だけ利用"
      }
    ]
  },
  {
    product: "牛脂マーラー鍋ベース",
    options: [
      {
        supplier: "南区調味料店",
        role: "メイン",
        referencePrice: 285,
        minOrder: "1 箱",
        leadTime: "当日",
        note: "価格変動を毎回確認"
      },
      {
        supplier: "城北食材卸",
        role: "予備",
        referencePrice: 298,
        minOrder: "1 箱",
        leadTime: "翌日",
        note: "メイン欠品時に利用"
      }
    ]
  },
  {
    product: "使い捨て食品手袋",
    options: [
      {
        supplier: "城北食材卸",
        role: "メイン",
        referencePrice: 29,
        minOrder: "5 箱",
        leadTime: "当日",
        note: "まとめ買い向き"
      },
      {
        supplier: "近隣業務スーパー",
        role: "緊急",
        referencePrice: 36,
        minOrder: "1 箱",
        leadTime: "即日",
        note: "不足時の店頭購入"
      }
    ]
  },
  {
    product: "生乳",
    options: [
      {
        supplier: "城北食材卸",
        role: "メイン",
        referencePrice: 198,
        minOrder: "12 本",
        leadTime: "当日",
        note: "冷蔵配送を優先"
      },
      {
        supplier: "近隣業務スーパー",
        role: "予備",
        referencePrice: 218,
        minOrder: "1 本",
        leadTime: "即日",
        note: "営業時間中の不足時に店頭購入"
      }
    ]
  }
];

export const accessProfiles = [
  {
    name: "本部購入担当",
    person: "李 本部",
    scope: "全店舗・全ブランド",
    stores: ["セントラル受取拠点", "東口テイクアウト店", "南町クラウド店"],
    visibleOrderIds: ["PO-0523-001", "PO-0523-002", "PO-0523-003", "PO-0522-006"],
    note: "横断購入、価格管理、購入先管理を担当"
  },
  {
    name: "店舗購入担当",
    person: "林 店舗",
    scope: "東口テイクアウト店のみ",
    stores: ["東口テイクアウト店"],
    visibleOrderIds: ["PO-0523-001", "PO-0522-006"],
    note: "自店舗の依頼、欠品報告、受け取り確認のみ操作"
  },
  {
    name: "ブランド別購入担当",
    person: "陳 ブランド",
    scope: "熱辣食堂ブランド",
    stores: ["セントラル受取拠点", "南町クラウド店"],
    visibleOrderIds: ["PO-0523-002", "PO-0523-003"],
    note: "担当ブランドの商品と依頼だけを表示"
  }
];
