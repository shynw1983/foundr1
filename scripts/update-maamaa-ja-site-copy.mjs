import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

const sections = [
  {
    pageKey: "home",
    sectionKey: "hero",
    title: "まぁ麻",
    subtitle: "出来立て麻辣湯",
    body: "その日の気分に合わせて、具材も、辛さも、しびれも自由に。まぁ麻は、選ぶ楽しさと出来立ての香りを大切にする麻辣湯専門店です。一杯ずつ鍋を分けて仕上げる、熱々の一杯をお楽しみください。",
    tags: ["出来立て", "麻辣湯", "Web予約"]
  },
  {
    pageKey: "home",
    sectionKey: "concept",
    title: "選ぶたのしさを、出来立てで。",
    subtitle: "Brand concept",
    body: "野菜、きのこ、肉、海鮮、麺。好きな具材を選んだら、辛さとしびれを好みに合わせて。一杯ずつ鍋を分け、スープの香りと具材の食感が立つ麻辣湯に仕上げます。",
    tags: ["選ぶ楽しさ", "出来立て", "香り"]
  },
  {
    pageKey: "home",
    sectionKey: "build-a-bowl",
    title: "一杯の中に、好きなものを少しずつ。",
    subtitle: "Build a bowl",
    body: "具材を選び、辛さとしびれを整え、気分に合う一杯へ。まぁ麻の麻辣湯は、選ぶ時間からおいしさが始まります。",
    tags: ["Cook", "Select", "Balance"],
    fields: {
      cards: [
        { title: "Cook", body: "一杯ずつ鍋を分けて、スープの香りと具材の食感を引き出します。" },
        { title: "Select", body: "野菜、きのこ、肉、海鮮、麺まで。その日の気分で自由に選べます。" },
        { title: "Balance", body: "辛さ、しびれ、香りを重ねて、自分にちょうどいい一杯へ。" }
      ]
    }
  },
  {
    pageKey: "home",
    sectionKey: "shops",
    title: "お近くのまぁ麻へ。",
    subtitle: "Shop information",
    body: "Web予約、デリバリー、店内飲食は、店舗ごとの受付状況に合わせてご利用いただけます。",
    tags: ["Web予約", "デリバリー", "テイクアウト", "店内飲食"]
  },
  {
    pageKey: "menu",
    sectionKey: "menu-hero",
    title: "好きな具材で、今日の麻辣湯を。",
    subtitle: "Web予約",
    body: "具材、麺、辛さ、痺れを選んで、自分好みの一杯をWeb予約できます。一杯ずつ鍋を分けて仕上げる、出来立ての麻辣湯をお楽しみください。",
    tags: ["Web予約", "辛さ", "痺れ", "具材"]
  },
  {
    pageKey: "footer",
    sectionKey: "footer",
    title: "まぁ麻",
    body: "選ぶ楽しさと出来立ての香りを届ける、麻辣湯専門店。"
  }
];

const translations = {
  "home/hero": {
    title: {
      en: "maamaa",
      zh: "まぁ麻",
      "zh-Hant": "まぁ麻",
      ko: "마마",
      vi: "maamaa",
      ne: "maamaa"
    },
    subtitle: {
      en: "Freshly Made Malatang",
      zh: "现做麻辣烫",
      "zh-Hant": "現做麻辣燙",
      ko: "갓 만든 마라탕",
      vi: "Malatang vừa nấu",
      ne: "ताजा मालाताङ"
    },
    body: {
      en: "Choose ingredients, spice, and mala tingle to match your mood. maamaa is a malatang shop built around the joy of choosing and the aroma of freshly finished bowls. Enjoy a steaming bowl finished one by one in a separate pot.",
      zh: "按当天的心情，自由选择食材、辣度和麻度。まぁ麻是一家重视“选择的乐趣”和“现做香气”的麻辣烫专门店。每一碗都分锅现做，请享用热气腾腾的一碗。",
      "zh-Hant": "依照當天的心情，自由選擇食材、辣度與麻度。まぁ麻是一家重視「選擇的樂趣」與「現做香氣」的麻辣燙專門店。每一碗都分鍋現做，請享用熱騰騰的一碗。",
      ko: "그날의 기분에 맞춰 재료도, 매운맛도, 얼얼함도 자유롭게. 마마는 고르는 즐거움과 갓 만든 향을 소중히 하는 마라탕 전문점입니다. 한 그릇씩 냄비를 나누어 완성한 뜨거운 한 그릇을 즐겨 보세요.",
      vi: "Tùy theo tâm trạng trong ngày, bạn có thể tự do chọn nguyên liệu, độ cay và độ tê. maamaa là tiệm malatang trân trọng niềm vui khi lựa chọn và hương thơm của món vừa nấu. Hãy thưởng thức một tô nóng hổi, được hoàn thiện riêng từng phần.",
      ne: "आजको मुडअनुसार सामग्री, पिरोपन र झमझमाहट स्वतन्त्र रूपमा छान्नुहोस्। maamaa छनोटको रमाइलो र ताजा पकाइको सुगन्धलाई महत्व दिने मालाताङ विशेषज्ञ पसल हो। एक-एक कचौरा छुट्टै पकाएर तयार गरिएको तातो मालाताङको मजा लिनुहोस्।"
    }
  },
  "home/concept": {
    title: {
      en: "Freshly made, exactly as you choose.",
      zh: "把选择的乐趣，做成热腾腾的一碗。",
      "zh-Hant": "把選擇的樂趣，做成熱騰騰的一碗。",
      ko: "고르는 즐거움을 갓 만든 한 그릇으로.",
      vi: "Niềm vui lựa chọn, trong một tô vừa nấu.",
      ne: "छनोटको रमाइलो, ताजा बनेको कचौरामा।"
    },
    body: {
      en: "Vegetables, mushrooms, meat, seafood, noodles. Pick what you like, then set the spice and tingle your way. We finish each bowl separately so the soup aroma and ingredient textures come through.",
      zh: "蔬菜、菌菇、肉类、海鲜、面类。选好喜欢的食材，再调整辣度和麻度。我们每一碗都分锅制作，让汤底香气和食材口感更清晰。",
      "zh-Hant": "蔬菜、菇類、肉類、海鮮、麵類。選好喜歡的食材，再調整辣度與麻度。我們每一碗都分鍋製作，讓湯底香氣與食材口感更清晰。",
      ko: "채소, 버섯, 고기, 해산물, 면. 좋아하는 재료를 고른 뒤 매운맛과 얼얼함을 취향에 맞춰 주세요. 한 그릇씩 냄비를 나누어 국물의 향과 재료의 식감이 살아 있는 마라탕으로 완성합니다.",
      vi: "Rau, nấm, thịt, hải sản, mì. Chọn nguyên liệu bạn thích, rồi chỉnh độ cay và độ tê theo khẩu vị. Mỗi tô được nấu riêng để giữ hương thơm của nước súp và kết cấu của nguyên liệu.",
      ne: "तरकारी, च्याउ, मासु, समुद्री खाना र नुडल। मनपर्ने सामग्री छानेपछि पिरोपन र झमझमाहट आफ्नो स्वादअनुसार मिलाउनुहोस्। प्रत्येक कचौरा छुट्टै पकाएर सुपको सुगन्ध र सामग्रीको बनावट राम्रो देखिने मालाताङ बनाइन्छ।"
    }
  },
  "home/build-a-bowl": {
    title: {
      en: "A little of everything you love, in one bowl.",
      zh: "把喜欢的食材，一点点放进同一碗里。",
      "zh-Hant": "把喜歡的食材，一點點放進同一碗裡。",
      ko: "좋아하는 것을 한 그릇 안에 조금씩.",
      vi: "Một chút những món bạn thích, trong cùng một tô.",
      ne: "मनपर्ने कुरा अलि-अलि एउटै कचौरामा।"
    },
    body: {
      en: "Choose ingredients, tune the spice and tingle, and build a bowl that fits your mood. At maamaa, the flavor starts from the moment you choose.",
      zh: "选择食材，调整辣度和麻度，做成符合当天心情的一碗。まぁ麻的美味，从选择的那一刻就开始了。",
      "zh-Hant": "選擇食材，調整辣度與麻度，做成符合當天心情的一碗。まぁ麻的美味，從選擇的那一刻就開始了。",
      ko: "재료를 고르고 매운맛과 얼얼함을 맞춰 그날의 기분에 맞는 한 그릇으로. 마마의 맛은 고르는 순간부터 시작됩니다.",
      vi: "Chọn nguyên liệu, chỉnh độ cay và độ tê, rồi tạo một tô hợp với tâm trạng của bạn. Với maamaa, vị ngon bắt đầu từ lúc bạn chọn.",
      ne: "सामग्री छान्नुहोस्, पिरोपन र झमझमाहट मिलाउनुहोस्, अनि आफ्नो मुडअनुसारको कचौरा बनाउनुहोस्। maamaa मा स्वाद छनोट गर्ने क्षणबाट सुरु हुन्छ।"
    }
  },
  "home/shops": {
    title: {
      en: "Find your nearest maamaa.",
      zh: "前往你附近的まぁ麻。",
      "zh-Hant": "前往你附近的まぁ麻。",
      ko: "가까운 마마로.",
      vi: "Tìm maamaa gần bạn.",
      ne: "नजिकको maamaa मा।"
    },
    body: {
      en: "Web reservations, delivery, and dine-in are available according to each shop's reception status.",
      zh: "Web 预约、外送和堂食会根据各店接单情况开放。",
      "zh-Hant": "Web 預約、外送與內用會依照各店接單情況開放。",
      ko: "Web 예약, 배달, 매장 식사는 매장별 접수 상황에 맞춰 이용할 수 있습니다.",
      vi: "Đặt trước qua Web, giao hàng và dùng tại chỗ được phục vụ tùy theo tình trạng tiếp nhận của từng cửa hàng.",
      ne: "Web आरक्षण, डेलिभरी र स्टोरभित्र भोजन प्रत्येक स्टोरको अर्डर स्थितिअनुसार उपलब्ध हुन्छ।"
    }
  },
  "menu/menu-hero": {
    title: {
      en: "Build today's malatang with the ingredients you love.",
      zh: "用喜欢的食材，做今天这一碗麻辣烫。",
      "zh-Hant": "用喜歡的食材，做今天這一碗麻辣燙。",
      ko: "좋아하는 재료로 오늘의 마라탕을.",
      vi: "Tạo tô malatang hôm nay bằng nguyên liệu bạn thích.",
      ne: "मनपर्ने सामग्रीले आजको मालाताङ बनाउनुहोस्।"
    },
    subtitle: {
      en: "Web reservation",
      zh: "Web 预约",
      "zh-Hant": "Web 預約",
      ko: "Web 예약",
      vi: "Đặt trước qua Web",
      ne: "Web आरक्षण"
    },
    body: {
      en: "Choose ingredients, noodles, spice, and mala tingle to reserve your own bowl online. Enjoy freshly finished malatang, cooked one bowl at a time in a separate pot.",
      zh: "选择食材、面类、辣度和麻度，Web 预约自己喜欢的一碗。每一碗分锅制作，请享用现做麻辣烫。",
      "zh-Hant": "選擇食材、麵類、辣度與麻度，Web 預約自己喜歡的一碗。每一碗分鍋製作，請享用現做麻辣燙。",
      ko: "재료, 면, 매운맛, 얼얼함을 골라 취향에 맞는 한 그릇을 Web으로 예약할 수 있습니다. 한 그릇씩 냄비를 나누어 완성하는 갓 만든 마라탕을 즐겨 보세요.",
      vi: "Chọn nguyên liệu, mì, độ cay và độ tê để đặt trước tô theo ý mình qua Web. Hãy thưởng thức malatang vừa nấu, được hoàn thiện riêng từng tô.",
      ne: "सामग्री, नुडल, पिरोपन र झमझमाहट छानेर आफ्नो स्वादको कचौरा Web बाट आरक्षण गर्न सक्नुहुन्छ। एक-एक कचौरा छुट्टै पकाएर तयार गरिएको ताजा मालाताङको मजा लिनुहोस्।"
    }
  },
  "footer/footer": {
    body: {
      en: "A malatang shop serving the joy of choosing and the aroma of freshly finished bowls.",
      zh: "带来选择乐趣与现做香气的麻辣烫专门店。",
      "zh-Hant": "帶來選擇樂趣與現做香氣的麻辣燙專門店。",
      ko: "고르는 즐거움과 갓 만든 향을 전하는 마라탕 전문점.",
      vi: "Tiệm malatang mang đến niềm vui lựa chọn và hương thơm của món vừa nấu.",
      ne: "छनोटको रमाइलो र ताजा पकाइको सुगन्ध दिने मालाताङ विशेषज्ञ पसल।"
    }
  }
};

let total = 0;

for (const section of sections) {
  const sectionTranslations = translations[`${section.pageKey}/${section.sectionKey}`] ?? {};
  const rows = await sql`
    update brand_site_sections
    set
      title = ${section.title},
      subtitle = ${section.subtitle ?? ""},
      body = ${section.body},
      tags = ${JSON.stringify(section.tags ?? [])}::jsonb,
      fields = case
        when ${Boolean(section.fields)} then ${JSON.stringify(section.fields ?? {})}::jsonb
        else fields
      end,
      title_display_names = ${JSON.stringify(sectionTranslations.title ?? {})}::jsonb,
      subtitle_display_names = ${JSON.stringify(sectionTranslations.subtitle ?? {})}::jsonb,
      body_display_names = ${JSON.stringify(sectionTranslations.body ?? {})}::jsonb,
      updated_at = now()
    where page_key = ${section.pageKey}
      and section_key = ${section.sectionKey}
      and brand_id in (
        select id
        from brands
        where lower(name) in ('maamaa', 'まぁ麻')
          or name ilike '%maamaa%'
          or name like '%まぁ麻%'
          or name like '%麻辣%'
      )
    returning id::text
  `;
  total += rows.length;
  console.log(`Updated ${rows.length} ${section.pageKey}/${section.sectionKey}`);
}

console.log(`Updated ${total} maamaa Japanese source section(s).`);
