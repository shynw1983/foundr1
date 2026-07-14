"use client";

import { MonitorSmartphone, ScanLine } from "lucide-react";
import jsQR from "jsqr";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { getStoredStoreSelection, setStoredStoreSelection } from "../../components/store-selection";
import { useDisplayMode } from "../../components/useDisplayMode";

type StoreOption = {
  id: string;
  name: string;
};

type DisplayItem = {
  name: string;
  optionLabel: string;
  weightLabel: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type DisplayState = {
  status: string;
  storeName: string;
  orderType: string;
  paymentMethod: string;
  paymentLabel: string;
  externalPaymentTerminalBrand: string;
  pickupCode: string;
  preferredLanguage: string;
  memberDisplayName: string;
  memberMessage: string;
  discountName: string;
  discountAmount: number;
  couponName: string;
  couponDiscountAmount: number;
  subtotal: number;
  taxLabel: string;
  taxAmount: number;
  cashTenderedAmount: number | null;
  cashChangeAmount: number | null;
  updatedLabel: string;
  updatedAt: string;
  memberScanCommand: {
    id: string;
    action: string;
    createdAt: string;
  } | null;
  items: DisplayItem[];
};

type CustomerDisplayMediaAsset = {
  id: string;
  type: "image" | "video";
  url: string;
  name: string;
  durationSeconds: number;
  fit: "cover" | "contain";
};

type CustomerDisplayMediaSettings = {
  mode: "default" | "slideshow" | "video";
  transition: "fade" | "slide" | "none";
  slideDurationSeconds: number;
  videoMuted: boolean;
  videoLoop: boolean;
  backgroundColor: string;
  assets: CustomerDisplayMediaAsset[];
};

const idleState: DisplayState = {
  status: "idle",
  storeName: "",
  orderType: "",
  paymentMethod: "cash",
  paymentLabel: "現金",
  externalPaymentTerminalBrand: "PayCAS",
  pickupCode: "",
  preferredLanguage: "",
  memberDisplayName: "",
  memberMessage: "",
  discountName: "",
  discountAmount: 0,
  couponName: "",
  couponDiscountAmount: 0,
  subtotal: 0,
  taxLabel: "",
  taxAmount: 0,
  cashTenderedAmount: null,
  cashChangeAmount: null,
  updatedLabel: "",
  updatedAt: "",
  memberScanCommand: null,
  items: []
};

const defaultMediaSettings: CustomerDisplayMediaSettings = {
  mode: "default",
  transition: "fade",
  slideDurationSeconds: 8,
  videoMuted: true,
  videoLoop: true,
  backgroundColor: "#fbfbf8",
  assets: []
};

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

type DisplayLanguage = "ja" | "zh" | "zh-Hant" | "en" | "ko" | "vi" | "ne";

const customerDisplayText: Record<DisplayLanguage, {
  welcome: string;
  welcomeBody: string;
  completed: string;
  thanks: string;
  thanksBody: string;
  cashChange: string;
  externalWait: string;
  confirmOrder: string;
  orderSection: string;
  itemCount: string;
  loading: string;
  waitingOrder: string;
  moreItems: string;
  pickupCode: string;
  counterCheckout: string;
  payment: string;
  total: string;
  discountApplied: string;
  couponApplied: string;
  cashTendered: string;
  change: string;
  shortage: string;
  terminalDefault: string;
  terminalInstruction: string;
  terminalMethods: string;
  memberMessage: string;
  eatIn: string;
  takeout: string;
  cash: string;
}> = {
  ja: {
    welcome: "Welcome",
    welcomeBody: "ご来店ありがとうございます",
    completed: "決済完了",
    thanks: "ありがとうございました",
    thanksBody: "またのご来店をお待ちしております",
    cashChange: "お釣りをお受け取りください",
    externalWait: "端末でお支払いください",
    confirmOrder: "注文内容をご確認ください",
    orderSection: "ご注文内容",
    itemCount: "点",
    loading: "読み込み中...",
    waitingOrder: "ご注文をお待ちしています。",
    moreItems: "ほか",
    pickupCode: "番号",
    counterCheckout: "店頭会計",
    payment: "お支払い",
    total: "合計",
    discountApplied: "割引適用",
    couponApplied: "クーポン適用",
    cashTendered: "お預り",
    change: "お釣り",
    shortage: "不足",
    terminalDefault: "決済端末",
    terminalInstruction: "決済端末でお支払いください",
    terminalMethods: "カード・電子マネー・QR 決済",
    memberMessage: "いつもご利用いただきありがとうございます。",
    eatIn: "店内",
    takeout: "持ち帰り",
    cash: "現金"
  },
  zh: {
    welcome: "Welcome",
    welcomeBody: "感谢光临",
    completed: "支付完成",
    thanks: "谢谢惠顾",
    thanksBody: "期待您的再次光临",
    cashChange: "请收取找零",
    externalWait: "请在终端完成支付",
    confirmOrder: "请确认订单内容",
    orderSection: "订单内容",
    itemCount: "件",
    loading: "加载中...",
    waitingOrder: "正在等待点单。",
    moreItems: "另有",
    pickupCode: "号码",
    counterCheckout: "店内结账",
    payment: "支付方式",
    total: "合计",
    discountApplied: "已应用折扣",
    couponApplied: "已应用优惠券",
    cashTendered: "已收款",
    change: "找零",
    shortage: "不足",
    terminalDefault: "支付终端",
    terminalInstruction: "请在支付终端完成支付",
    terminalMethods: "银行卡・电子钱包・二维码支付",
    memberMessage: "感谢您一直以来的支持。",
    eatIn: "店内",
    takeout: "外带",
    cash: "现金"
  },
  "zh-Hant": {
    welcome: "Welcome",
    welcomeBody: "感謝光臨",
    completed: "付款完成",
    thanks: "謝謝惠顧",
    thanksBody: "期待您的再次光臨",
    cashChange: "請收取找零",
    externalWait: "請在終端完成付款",
    confirmOrder: "請確認訂單內容",
    orderSection: "訂單內容",
    itemCount: "件",
    loading: "載入中...",
    waitingOrder: "正在等待點單。",
    moreItems: "另有",
    pickupCode: "號碼",
    counterCheckout: "店內結帳",
    payment: "付款方式",
    total: "合計",
    discountApplied: "已套用折扣",
    couponApplied: "已套用優惠券",
    cashTendered: "已收款",
    change: "找零",
    shortage: "不足",
    terminalDefault: "支付終端",
    terminalInstruction: "請在支付終端完成付款",
    terminalMethods: "信用卡・電子錢包・QR 付款",
    memberMessage: "感謝您一直以來的支持。",
    eatIn: "店內",
    takeout: "外帶",
    cash: "現金"
  },
  en: {
    welcome: "Welcome",
    welcomeBody: "Thank you for visiting us",
    completed: "Payment complete",
    thanks: "Thank you",
    thanksBody: "We look forward to seeing you again",
    cashChange: "Please take your change",
    externalWait: "Please pay at the terminal",
    confirmOrder: "Please check your order",
    orderSection: "Order details",
    itemCount: "items",
    loading: "Loading...",
    waitingOrder: "Waiting for your order.",
    moreItems: "more",
    pickupCode: "No.",
    counterCheckout: "Counter checkout",
    payment: "Payment",
    total: "Total",
    discountApplied: "Discount applied",
    couponApplied: "Coupon applied",
    cashTendered: "Received",
    change: "Change",
    shortage: "Short",
    terminalDefault: "Payment terminal",
    terminalInstruction: "Please pay at the terminal",
    terminalMethods: "Card, e-money, or QR payment",
    memberMessage: "Thank you for your continued support.",
    eatIn: "Eat in",
    takeout: "Takeout",
    cash: "Cash"
  },
  ko: {
    welcome: "Welcome",
    welcomeBody: "방문해 주셔서 감사합니다",
    completed: "결제 완료",
    thanks: "감사합니다",
    thanksBody: "또 방문해 주세요",
    cashChange: "거스름돈을 받아 주세요",
    externalWait: "단말기에서 결제해 주세요",
    confirmOrder: "주문 내용을 확인해 주세요",
    orderSection: "주문 내용",
    itemCount: "개",
    loading: "불러오는 중...",
    waitingOrder: "주문을 기다리고 있습니다.",
    moreItems: "외",
    pickupCode: "번호",
    counterCheckout: "매장 결제",
    payment: "결제",
    total: "합계",
    discountApplied: "할인 적용",
    couponApplied: "쿠폰 적용",
    cashTendered: "받은 금액",
    change: "거스름돈",
    shortage: "부족",
    terminalDefault: "결제 단말기",
    terminalInstruction: "결제 단말기에서 결제해 주세요",
    terminalMethods: "카드・전자머니・QR 결제",
    memberMessage: "항상 이용해 주셔서 감사합니다.",
    eatIn: "매장",
    takeout: "포장",
    cash: "현금"
  },
  vi: {
    welcome: "Welcome",
    welcomeBody: "Cảm ơn quý khách đã ghé thăm",
    completed: "Thanh toán hoàn tất",
    thanks: "Xin cảm ơn",
    thanksBody: "Hẹn gặp lại quý khách",
    cashChange: "Vui lòng nhận tiền thừa",
    externalWait: "Vui lòng thanh toán tại thiết bị",
    confirmOrder: "Vui lòng kiểm tra đơn hàng",
    orderSection: "Nội dung đơn hàng",
    itemCount: "món",
    loading: "Đang tải...",
    waitingOrder: "Đang chờ đơn hàng.",
    moreItems: "món khác",
    pickupCode: "Số",
    counterCheckout: "Thanh toán tại quầy",
    payment: "Thanh toán",
    total: "Tổng cộng",
    discountApplied: "Đã áp dụng giảm giá",
    couponApplied: "Đã áp dụng phiếu ưu đãi",
    cashTendered: "Đã nhận",
    change: "Tiền thừa",
    shortage: "Thiếu",
    terminalDefault: "Thiết bị thanh toán",
    terminalInstruction: "Vui lòng thanh toán tại thiết bị",
    terminalMethods: "Thẻ, tiền điện tử hoặc QR",
    memberMessage: "Cảm ơn quý khách luôn ủng hộ.",
    eatIn: "Ăn tại quán",
    takeout: "Mang đi",
    cash: "Tiền mặt"
  },
  ne: {
    welcome: "Welcome",
    welcomeBody: "आउनु भएकोमा धन्यवाद",
    completed: "भुक्तानी पूरा भयो",
    thanks: "धन्यवाद",
    thanksBody: "फेरि भेट्ने आशा छ",
    cashChange: "कृपया फिर्ता रकम लिनुहोस्",
    externalWait: "कृपया टर्मिनलमा भुक्तानी गर्नुहोस्",
    confirmOrder: "कृपया अर्डर जाँच गर्नुहोस्",
    orderSection: "अर्डर विवरण",
    itemCount: "वटा",
    loading: "लोड हुँदै...",
    waitingOrder: "अर्डरको प्रतीक्षा गर्दै।",
    moreItems: "थप",
    pickupCode: "नं.",
    counterCheckout: "काउन्टर भुक्तानी",
    payment: "भुक्तानी",
    total: "जम्मा",
    discountApplied: "छुट लागू",
    couponApplied: "कुपन लागू",
    cashTendered: "प्राप्त रकम",
    change: "फिर्ता रकम",
    shortage: "अपुरो",
    terminalDefault: "भुक्तानी टर्मिनल",
    terminalInstruction: "कृपया टर्मिनलमा भुक्तानी गर्नुहोस्",
    terminalMethods: "कार्ड, ई-मनी वा QR भुक्तानी",
    memberMessage: "सधैंको साथका लागि धन्यवाद।",
    eatIn: "यहीँ खाने",
    takeout: "लैजाने",
    cash: "नगद"
  }
};

function normalizeDisplayLanguage(value: string): DisplayLanguage {
  return value === "zh" || value === "zh-Hant" || value === "en" || value === "ko" || value === "vi" || value === "ne" ? value : "ja";
}

function getStatusLabel(state: DisplayState, text: (typeof customerDisplayText)[DisplayLanguage]) {
  if (state.status === "advertising") return text.welcomeBody;
  if (state.status === "complete") return text.completed;
  if (state.status === "cash_change") return text.cashChange;
  if (state.status === "external_wait") return text.externalWait;
  if (state.items.length > 0) return text.confirmOrder;
  return text.welcomeBody;
}

function getOrderTypeLabel(value: string, text: (typeof customerDisplayText)[DisplayLanguage]) {
  if (value === "eat_in") return text.eatIn;
  if (value === "takeout") return text.takeout;
  return "";
}

const customerDisplayTaxText: Record<DisplayLanguage, { included: string; excluded: string }> = {
  ja: { included: "内消費税", excluded: "消費税" },
  zh: { included: "内含消费税", excluded: "消费税" },
  "zh-Hant": { included: "內含消費稅", excluded: "消費稅" },
  en: { included: "Tax included", excluded: "Tax" },
  ko: { included: "내부 소비세", excluded: "소비세" },
  vi: { included: "Đã gồm thuế", excluded: "Thuế" },
  ne: { included: "कर समावेश", excluded: "कर" }
};

function translateTaxLabel(label: string, language: DisplayLanguage) {
  if (language === "ja") return label;
  const rateMatch = label.match(/(\d+(?:\.\d+)?)%/);
  const prefix = label.startsWith("消費税") ? customerDisplayTaxText[language].excluded : customerDisplayTaxText[language].included;
  return rateMatch?.[1] ? `${prefix} ${rateMatch[1]}%` : prefix;
}

function formatMemberDisplayName(name: string, language: DisplayLanguage) {
  const normalizedName = String(name || "").trim();
  if (language === "ja") return normalizedName;
  return normalizedName.replace(/様$/u, "").trim();
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function CustomerDisplayPage() {
  const memberScannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const memberScannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const memberScannerStreamRef = useRef<MediaStream | null>(null);
  const memberScannerActiveRef = useRef(false);
  const memberScanCommandIdRef = useRef("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [state, setState] = useState<DisplayState>(idleState);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [memberScannerOpen, setMemberScannerOpen] = useState(false);
  const [memberScannerMessage, setMemberScannerMessage] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "polling">("connecting");
  const [clockDate, setClockDate] = useState(() => new Date());
  const [mediaSettings, setMediaSettings] = useState<CustomerDisplayMediaSettings>(defaultMediaSettings);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 800 });
  const selectedStoreIdRef = useRef("");
  const { activateDisplayMode, fullscreenActive, wakeLockActive, wakeLockSupported } = useDisplayMode();

  const visibleItems = state.items;
  const orderLayout = useMemo(() => {
    const itemCount = Math.max(1, state.items.length);
    const chromeHeight = viewportSize.width <= 820 ? 280 : 180;
    const availableListHeight = Math.max(180, viewportSize.height - chromeHeight);
    const targetRowHeight = availableListHeight / itemCount;
    const rowPressure = (targetRowHeight - 22) / 46;
    const itemPressure = 1 - Math.max(0, itemCount - 2) * 0.11;
    const viewportPressure = viewportSize.height < 760 ? 0.92 : 1;
    const scale = Math.round(clampNumber(Math.min(rowPressure, itemPressure, viewportPressure), 0.42, 0.92) * 1000) / 1000;
    return {
      scale,
      nameLines: targetRowHeight >= 72 && scale >= 0.7 ? 2 : 1,
      metaLines: targetRowHeight >= 64 && scale >= 0.62 ? 2 : 1
    };
  }, [state.items.length, viewportSize.height, viewportSize.width]);
  const orderScale = orderLayout.scale;
  const orderMetaLineHeight = Math.round((1.14 + 0.08 * orderScale) * 1000) / 1000;
  const orderLayoutStyle = {
    "--order-scale": orderScale,
    "--order-row-min": `${Math.round(24 + 28 * orderScale)}px`,
    "--order-row-gap": `${Math.round(3 + 6 * orderScale)}px`,
    "--order-row-inner-gap": `${Math.round(4 + 8 * orderScale)}px`,
    "--order-content-gap": `${Math.round(1 + 2 * orderScale)}px`,
    "--order-row-padding-y": `${Math.round(2 + 6 * orderScale)}px`,
    "--order-row-padding-x": `${Math.round(5 + 6 * orderScale)}px`,
    "--order-name-size": `${Math.round((8.5 + 11.5 * orderScale) * 10) / 10}px`,
    "--order-meta-size": `${Math.round((7.5 + 3.5 * orderScale) * 10) / 10}px`,
    "--order-amount-size": `${Math.round((8.5 + 12.5 * orderScale) * 10) / 10}px`,
    "--order-line-height": Math.round((1.03 + 0.13 * orderScale) * 1000) / 1000,
    "--order-meta-line-height": orderMetaLineHeight,
    "--order-name-lines": orderLayout.nameLines,
    "--order-meta-lines": orderLayout.metaLines,
    "--order-meta-max-height": `${Math.ceil((7.5 + 3.5 * orderScale) * orderMetaLineHeight * orderLayout.metaLines + 2)}px`,
    "--order-amount-column": `${Math.round(54 + 48 * orderScale)}px`
  } as CSSProperties;
  const changeAmount = state.cashChangeAmount ?? 0;
  const advertisingActive = state.status === "advertising";
  const completeActive = state.status === "complete";
  const slideshowAssets = useMemo(() => mediaSettings.assets.filter((asset) => asset.type === "image"), [mediaSettings.assets]);
  const videoAsset = useMemo(() => mediaSettings.assets.find((asset) => asset.type === "video"), [mediaSettings.assets]);
  const activeSlideshowAsset = slideshowAssets[activeMediaIndex % Math.max(1, slideshowAssets.length)];
  const useMediaAdvertising = advertisingActive && (
    (mediaSettings.mode === "slideshow" && slideshowAssets.length > 0) ||
    (mediaSettings.mode === "video" && Boolean(videoAsset))
  );
  const displayLanguage = normalizeDisplayLanguage(state.preferredLanguage);
  const text = customerDisplayText[displayLanguage];
  const topStatusLabel = getStatusLabel(state, text);
  const paymentLabel = state.paymentMethod === "cash" ? text.cash : state.paymentLabel || text.payment;
  const memberDisplayName = formatMemberDisplayName(state.memberDisplayName, displayLanguage);
  const memberMessage = displayLanguage === "ja" ? state.memberMessage || text.memberMessage : text.memberMessage;
  const showTopStatus = true;
  const clockLabel = useMemo(() => new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(clockDate), [clockDate]);
  const clockSubLabel = useMemo(() => new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(clockDate), [clockDate]);

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockDate(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    function updateViewportSize() {
      setViewportSize({
        width: window.innerWidth || 1280,
        height: window.innerHeight || 800
      });
    }

    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    window.visualViewport?.addEventListener("resize", updateViewportSize);
    return () => {
      window.removeEventListener("resize", updateViewportSize);
      window.visualViewport?.removeEventListener("resize", updateViewportSize);
    };
  }, []);

  useEffect(() => {
    if (!advertisingActive || mediaSettings.mode !== "slideshow" || slideshowAssets.length <= 1) {
      setActiveMediaIndex(0);
      return;
    }
    const activeAsset = slideshowAssets[activeMediaIndex % slideshowAssets.length];
    const duration = Math.max(3, Number(activeAsset?.durationSeconds || mediaSettings.slideDurationSeconds || 8)) * 1000;
    const timer = window.setTimeout(() => {
      setActiveMediaIndex((current) => (current + 1) % slideshowAssets.length);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [activeMediaIndex, advertisingActive, mediaSettings.mode, mediaSettings.slideDurationSeconds, slideshowAssets]);

  useEffect(() => {
    if (!memberScannerOpen) return;
    let cancelled = false;
    let frameId = 0;

    async function postScannedMemberCode(code: string) {
      const storeId = selectedStoreIdRef.current;
      if (!storeId) {
        throw new Error("店舗を選択してください。");
      }
      const response = await fetch("/api/store/pos/customer-display/member-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, code })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "POS に会員 QR を送信できませんでした。");
      setMessage("会員 QR を POS に送信しました。");
    }

    async function startScanner() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMemberScannerMessage("カメラを利用できません。");
        return;
      }

      try {
        setMemberScannerMessage("お客さまの会員 QR を前面カメラにかざしてください。");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        memberScannerStreamRef.current = stream;
        const video = memberScannerVideoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        memberScannerActiveRef.current = true;
        const scan = () => {
          if (cancelled || !memberScannerActiveRef.current) return;
          try {
            const canvas = memberScannerCanvasRef.current;
            const context = canvas?.getContext("2d", { willReadFrequently: true });
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!canvas || !context || !width || !height) {
              frameId = window.requestAnimationFrame(scan);
              return;
            }
            canvas.width = width;
            canvas.height = height;
            context.drawImage(video, 0, 0, width, height);
            const imageData = context.getImageData(0, 0, width, height);
            const result = jsQR(imageData.data, width, height);
            const code = result?.data?.trim();
            if (code) {
              memberScannerActiveRef.current = false;
              setMemberScannerMessage("会員 QR を読み取りました。");
              void postScannedMemberCode(code)
                .then(() => setMemberScannerOpen(false))
                .catch((error) => {
                  setMemberScannerMessage(error instanceof Error ? error.message : "POS に送信できませんでした。");
                  memberScannerActiveRef.current = true;
                  frameId = window.requestAnimationFrame(scan);
                });
              return;
            }
          } catch {
            setMemberScannerMessage("QR を読み取れません。角度を変えてもう一度かざしてください。");
          }
          frameId = window.requestAnimationFrame(scan);
        };
        frameId = window.requestAnimationFrame(scan);
      } catch {
        setMemberScannerMessage("カメラを起動できません。ブラウザまたは端末のカメラ権限を確認してください。");
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      memberScannerActiveRef.current = false;
      if (frameId) window.cancelAnimationFrame(frameId);
      memberScannerStreamRef.current?.getTracks().forEach((track) => track.stop());
      memberScannerStreamRef.current = null;
      if (memberScannerVideoRef.current) memberScannerVideoRef.current.srcObject = null;
    };
  }, [memberScannerOpen]);

  useEffect(() => {
    const command = state.memberScanCommand;
    const commandId = String(command?.id ?? "").trim();
    if (!commandId || commandId === memberScanCommandIdRef.current || command?.action !== "open_scanner") return;
    const ageMs = Date.now() - new Date(command.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 2 * 60 * 1000) return;
    memberScanCommandIdRef.current = commandId;
    setMenuOpen(false);
    setMemberScannerOpen(true);
  }, [state.memberScanCommand]);

  useEffect(() => {
    if (realtimeStatus === "connected") return;
    let active = true;

    async function checkMemberScanCommand() {
      const storeId = selectedStoreIdRef.current;
      if (!storeId || memberScannerOpen) return;
      const params = new URLSearchParams({ storeId });
      if (memberScanCommandIdRef.current) params.set("commandSince", memberScanCommandIdRef.current);
      const response = await fetch(`/api/store/pos/customer-display/member-scan?${params.toString()}`, { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      const body = await response.json().catch(() => ({})) as { scanCommand?: { id?: string; action?: string } | null };
      const command = body.scanCommand;
      const commandId = String(command?.id ?? "").trim();
      if (!commandId || commandId === memberScanCommandIdRef.current || command?.action !== "open_scanner") return;
      memberScanCommandIdRef.current = commandId;
      setMenuOpen(false);
      setMemberScannerOpen(true);
    }

    void checkMemberScanCommand();
    const interval = window.setInterval(checkMemberScanCommand, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [memberScannerOpen, realtimeStatus]);

  async function load(storeId = selectedStoreIdRef.current || getStoredStoreSelection()) {
    const params = new URLSearchParams();
    if (storeId) params.set("storeId", storeId);
    const response = await fetch(`/api/store/pos/customer-display${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error || "客席表示データを読み込めませんでした。");
      setLoading(false);
      return;
    }
    const nextStoreId = body.selectedStoreId ?? storeId ?? "";
    setStores(body.access?.stores ?? []);
    setSelectedStoreId(nextStoreId);
    selectedStoreIdRef.current = nextStoreId;
    if (nextStoreId) setStoredStoreSelection(nextStoreId);
    setState({ ...idleState, ...(body.state ?? {}) });
    setMediaSettings({ ...defaultMediaSettings, ...(body.customerDisplayMediaSettings ?? {}) });
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const storeId = params.get("storeId") || getStoredStoreSelection();
    selectedStoreIdRef.current = storeId;
    void load(storeId);
    const interval = window.setInterval(() => {
      const currentStoreId = new URLSearchParams(window.location.search).get("storeId") || selectedStoreIdRef.current || getStoredStoreSelection();
      void load(currentStoreId);
    }, realtimeStatus === "connected" ? 60000 : 15000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeStatus]);

  useEffect(() => {
    let pusher: any;
    let channels: any[] = [];
    let active = true;
    const storeId = selectedStoreId;
    if (!storeId) {
      setRealtimeStatus("polling");
      return () => {
        active = false;
      };
    }

    const refreshDisplay = (payload?: { storeId?: string; state?: Partial<DisplayState> }) => {
      if (payload?.storeId && payload.storeId !== selectedStoreIdRef.current) return;
      if (payload?.state) {
        setState({ ...idleState, ...payload.state });
        setMessage("");
        setLoading(false);
        return;
      }
      void load(selectedStoreIdRef.current);
    };

    setRealtimeStatus("connecting");
    fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!active) return;
        if (!config?.key || !config?.cluster || !config?.channels?.length) {
          setRealtimeStatus("polling");
          return;
        }
        const { default: Pusher } = await import("pusher-js");
        if (!active) return;
        pusher = new Pusher(config.key, {
          cluster: config.cluster,
          channelAuthorization: {
            endpoint: "/api/store/realtime-auth",
            transport: "ajax"
          }
        });
        pusher.connection.bind("unavailable", () => {
          if (active) setRealtimeStatus("polling");
        });
        pusher.connection.bind("failed", () => {
          if (active) setRealtimeStatus("polling");
        });
        pusher.connection.bind("disconnected", () => {
          if (active) setRealtimeStatus("polling");
        });
        channels = config.channels.map((channelName: string) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("pusher:subscription_succeeded", () => {
            if (active) setRealtimeStatus("connected");
          });
          channel.bind("pusher:subscription_error", () => {
            if (active) setRealtimeStatus("polling");
          });
          channel.bind("pos.customer-display.updated", refreshDisplay);
          return channel;
        });
      })
      .catch(() => {
        if (active) setRealtimeStatus("polling");
      });

    return () => {
      active = false;
      channels.forEach((channel) => {
        channel.unbind("pos.customer-display.updated", refreshDisplay);
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId]);

  function handleStoreChange(storeId: string) {
    setSelectedStoreId(storeId);
    selectedStoreIdRef.current = storeId;
    setStoredStoreSelection(storeId);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("storeId", storeId);
    window.history.replaceState(null, "", nextUrl.toString());
    void load(storeId);
  }

  const hasDiscount = Boolean(state.discountName && state.discountAmount > 0);
  const hasCoupon = Boolean(state.couponName && state.couponDiscountAmount > 0);
  const hasPromotions = hasDiscount || hasCoupon;

  return (
    <main className={[
      "customer-display-page",
      advertisingActive || completeActive ? "is-advertising" : ""
    ].filter(Boolean).join(" ")} style={orderLayoutStyle}>
      <button
        className={`store-display-menu-button customer-display-menu-button ${realtimeStatus === "connected" ? "is-realtime" : "is-polling"}`}
        type="button"
        aria-label="メニュー"
        onClick={() => {
          if (!menuOpen) void activateDisplayMode();
          setMenuOpen((current) => !current);
        }}
      />
      {menuOpen ? (
        <div className="store-display-menu customer-display-menu">
          <strong>客席表示</strong>
          {stores.length > 1 ? (
            <select value={selectedStoreId} onChange={(event) => handleStoreChange(event.target.value)}>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          ) : null}
          <button className="secondary-button" type="button" onClick={() => void load(selectedStoreIdRef.current)}>
            {loading ? "読み込み中" : "更新"}
          </button>
          <button className="secondary-button" type="button" onClick={() => void activateDisplayMode()}>
            全画面・常時点灯 ON
          </button>
          <small>全画面 {fullscreenActive ? "ON" : "OFF"} / 常時点灯 {wakeLockActive ? "ON" : wakeLockSupported ? "OFF" : "使用不可"} / 同期 {realtimeStatus === "connected" ? "リアルタイム" : "自動更新"}</small>
          <a className="secondary-button" href="/store/pos">POS</a>
          <a className="secondary-button" href="/store">店舗ホーム</a>
          <a className="danger-button" href="/store/logout">ログアウト</a>
        </div>
      ) : null}

      {memberScannerOpen ? (
        <div className="store-pos-scanner-overlay customer-display-scanner-overlay" role="dialog" aria-modal="true" aria-label="会員 QR 読取">
          <div className="store-pos-scanner-dialog customer-display-scanner-dialog">
            <div className="store-pos-scanner-head">
              <div>
                <p className="eyebrow">Member QR</p>
                <h3>会員 QR 読取</h3>
                <span>客席表示タブレットの前面カメラで、お客さまの会員 QR を読み取ります。</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setMemberScannerOpen(false)}>閉じる</button>
            </div>
            <div className="store-pos-scanner-video">
              <video ref={memberScannerVideoRef} playsInline muted />
              <canvas ref={memberScannerCanvasRef} aria-hidden="true" />
              <div className="store-pos-scanner-frame" aria-hidden="true" />
            </div>
            <p className="store-pos-scanner-message">{memberScannerMessage || "カメラを準備しています。"}</p>
            <div className="store-pos-scanner-fallback">
              <ScanLine size={16} />
              <span>読み取り後、POS 側の会計に会員情報が自動で反映されます。</span>
            </div>
          </div>
        </div>
      ) : null}

      {advertisingActive || completeActive ? (
        <section
          className={[
            "customer-display-advertising",
            completeActive ? "is-thanks" : "",
            useMediaAdvertising ? `has-media is-${mediaSettings.transition}` : ""
          ].filter(Boolean).join(" ")}
          style={{ backgroundColor: useMediaAdvertising ? mediaSettings.backgroundColor : undefined }}
          aria-live="polite"
        >
          {useMediaAdvertising && mediaSettings.mode === "slideshow" && activeSlideshowAsset ? (
            <img
              className="customer-display-advertising-media"
              key={activeSlideshowAsset.id}
              src={activeSlideshowAsset.url}
              alt=""
              style={{ objectFit: activeSlideshowAsset.fit }}
            />
          ) : null}
          {useMediaAdvertising && mediaSettings.mode === "video" && videoAsset ? (
            <video
              className="customer-display-advertising-media"
              key={videoAsset.id}
              src={videoAsset.url}
              autoPlay
              muted={mediaSettings.videoMuted}
              loop={mediaSettings.videoLoop}
              playsInline
              style={{ objectFit: videoAsset.fit }}
            />
          ) : null}
          <div className="customer-display-clock" aria-label={`${clockLabel} ${clockSubLabel}`}>
            <span>{clockLabel}</span>
            <small>{clockSubLabel}</small>
          </div>
          <div className={useMediaAdvertising ? "customer-display-advertising-copy is-hidden" : "customer-display-advertising-copy"}>
            <strong>{completeActive ? text.thanks : text.welcome}</strong>
            <p>{completeActive ? text.thanksBody : text.welcomeBody}</p>
          </div>
        </section>
      ) : (
        <>
      <header className="customer-display-topbar">
        <div className="customer-display-clock" aria-label={`${clockLabel} ${clockSubLabel}`}>
          <span>{clockLabel}</span>
          <small>{clockSubLabel}</small>
        </div>
        {showTopStatus ? (
          <div className={`customer-display-status-title is-${state.status || "idle"}`}>
            <span />
            <h1>{topStatusLabel}</h1>
          </div>
        ) : null}
      </header>

      {message ? <div className="customer-display-message">{message}</div> : null}

      <section className="customer-display-layout">
        <div className="customer-display-items">
          <div className="customer-display-section-head">
            <span>{text.orderSection}</span>
            <strong>{state.items.reduce((sum, item) => sum + item.quantity, 0)} {text.itemCount}</strong>
          </div>

          {loading ? (
            <div className="customer-display-empty">
              <MonitorSmartphone />
              <p>{text.loading}</p>
            </div>
          ) : state.items.length === 0 ? (
            <div className="customer-display-empty">
              <MonitorSmartphone />
              <p>{text.waitingOrder}</p>
            </div>
          ) : (
            <div className="customer-display-item-list">
              {visibleItems.map((item, index) => (
                <div className="customer-display-item" key={`${item.name}-${index}`}>
                  <div>
                    <strong>{item.name}</strong>
                    {item.weightLabel ? <span>{item.weightLabel}</span> : null}
                    {item.optionLabel ? <span>{item.optionLabel}</span> : null}
                  </div>
                  <em>{item.weightLabel ? "" : `x${item.quantity}`}</em>
                  <b>{formatYen(item.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className={`customer-display-payment is-${state.status || "idle"}`}>
          {memberDisplayName ? (
            <div className="customer-display-member">
              <span>{memberDisplayName}</span>
              <strong>{memberMessage}</strong>
            </div>
          ) : null}

          <div className="customer-display-meta">
            {state.pickupCode ? <span>{text.pickupCode} {state.pickupCode}</span> : <span>{getOrderTypeLabel(state.orderType, text) || text.counterCheckout}</span>}
            <span>{paymentLabel}</span>
          </div>

          <div className="customer-display-total">
            <span>{text.total}</span>
            <strong>{formatYen(state.subtotal)}</strong>
            {state.taxLabel && state.taxAmount > 0 ? (
              <small>
                <em>{translateTaxLabel(state.taxLabel, displayLanguage)}</em>
                <b>{formatYen(state.taxAmount)}</b>
              </small>
            ) : null}
          </div>

          <div className={`customer-display-settlement is-${state.paymentMethod === "cash" ? "cash" : "terminal"} ${hasPromotions ? "has-promotions" : ""}`}>
            {state.paymentMethod === "cash" ? (
              <>
                {hasDiscount ? (
                  <div className="customer-display-discount">
                    <span>{text.discountApplied}</span>
                    <strong>{state.discountName}</strong>
                    <b>-{formatYen(state.discountAmount)}</b>
                  </div>
                ) : null}

                {hasCoupon ? (
                  <div className="customer-display-discount">
                    <span>{text.couponApplied}</span>
                    <strong>{state.couponName}</strong>
                    <b>-{formatYen(state.couponDiscountAmount)}</b>
                  </div>
                ) : null}

                <div className="customer-display-cash-card">
                  <span>{text.cashTendered}</span>
                  <strong>{state.cashTenderedAmount === null ? "-" : formatYen(state.cashTenderedAmount)}</strong>
                </div>
                <div className={`customer-display-cash-card ${changeAmount < 0 ? "is-short" : ""}`}>
                  <span>{text.change}</span>
                  <strong>{state.cashChangeAmount === null ? "-" : formatYen(Math.max(0, changeAmount))}</strong>
                  {changeAmount < 0 ? <small>{text.shortage} {formatYen(Math.abs(changeAmount))}</small> : null}
                </div>
              </>
            ) : (
              <>
                {hasPromotions ? (
                  <div className="customer-display-promotion-group">
                    {hasDiscount ? (
                      <div className="customer-display-discount">
                        <span>{text.discountApplied}</span>
                        <strong>{state.discountName}</strong>
                        <b>-{formatYen(state.discountAmount)}</b>
                      </div>
                    ) : null}

                    {hasCoupon ? (
                      <div className="customer-display-discount">
                        <span>{text.couponApplied}</span>
                        <strong>{state.couponName}</strong>
                        <b>-{formatYen(state.couponDiscountAmount)}</b>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="customer-display-terminal">
                  <span>{state.externalPaymentTerminalBrand || paymentLabel || text.terminalDefault}</span>
                  <strong>{text.terminalInstruction}</strong>
                  <small>{text.terminalMethods}</small>
                </div>
              </>
            )}
          </div>
        </aside>
      </section>
        </>
      )}
    </main>
  );
}
