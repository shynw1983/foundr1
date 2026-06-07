"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { ChevronDown, Home, Loader2, LogOut, Save, Settings, ShoppingBag, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MemberAuthPanel } from "../../../components/member/MemberAuthPanel";
import { MemberLanguageSwitcher, useMemberLanguage } from "../../../components/member/MemberLanguageProvider";

type MemberProfile = {
  memberNumber: string;
  displayName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  nameKana: string;
  phone: string;
  email: string;
  birthday: string;
  preferredLanguage: string;
  preferredStoreId: string;
  marketingOptIn: boolean;
  lineLinked: boolean;
};

type MemberResponse = {
  configured?: boolean;
  authenticated?: boolean;
  member?: MemberProfile | null;
  preferredStoreOptions?: PreferredStoreOption[];
  error?: string;
};

type PreferredStoreOption = {
  value: string;
  label: string;
};

type MemberSettingsForm = {
  displayName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  nameKana: string;
  lastNameKana: string;
  firstNameKana: string;
  phone: string;
  phonePart1: string;
  phonePart2: string;
  phonePart3: string;
  birthday: string;
  preferredLanguage: string;
  preferredStoreId: string;
  marketingOptIn: boolean;
  lineLinked: boolean;
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const emptyMemberSettings: MemberSettingsForm = {
  displayName: "",
  lastName: "",
  firstName: "",
  fullName: "",
  nameKana: "",
  lastNameKana: "",
  firstNameKana: "",
  phone: "",
  phonePart1: "",
  phonePart2: "",
  phonePart3: "",
  birthday: "",
  preferredLanguage: "ja",
  preferredStoreId: "",
  marketingOptIn: false,
  lineLinked: false
};

const memberSettingsText = {
  ja: {
    member: "会員",
    notConfiguredTitle: "Clerk の環境変数が未設定です。",
    notConfiguredBody: "`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` と `CLERK_SECRET_KEY` を設定してください。",
    accountMenuLabel: "会員メニュー",
    loggedIn: "ログイン中",
    memberNumber: "会員番号",
    backToCard: "会員証に戻る",
    orderHistory: "購入履歴・領収書",
    signOut: "ログアウト",
    eyebrow: "Account Settings",
    title: "会員情報",
    subtitle: "店頭での会員確認と予約時の自動入力に使用する情報を設定できます。",
    authTitle: "会員情報にログイン",
    authDescription: "メールアドレスに確認コードを送信して、会員情報を編集できます。",
    panelTitle: "会員情報",
    completeTitle: "会員登録を完了してください",
    completeBody: "ポイント利用と予約時の自動入力には、表示名・氏名・電話番号が必要です。",
    loading: "会員情報を読み込んでいます。",
    note: "表示名、氏名、電話番号は会員確認に必要です。その他の項目は任意で設定できます。",
    displayName: "表示名・ニックネーム",
    displayNamePlaceholder: "例: Maamaa fan",
    lastName: "姓",
    lastNamePlaceholder: "例: 山田",
    firstName: "名",
    firstNamePlaceholder: "例: 太郎",
    lastNameKana: "セイ（任意）",
    lastNameKanaPlaceholder: "例: ヤマダ",
    firstNameKana: "メイ（任意）",
    firstNameKanaPlaceholder: "例: タロウ",
    phone: "電話番号",
    phonePart1: "電話番号 1",
    phonePart2: "電話番号 2",
    phonePart3: "電話番号 3",
    birthday: "生年月日（任意）",
    preferredStore: "よく利用する店舗（任意）",
    preferredLanguage: "表示言語（任意）",
    unset: "未設定",
    marketingOptIn: "クーポンやキャンペーンのお知らせを受け取る",
    lineLinked: "LINE連携済みとして記録する（本連携機能は準備中）",
    save: "会員情報を保存",
    saving: "保存中...",
    loadError: "会員情報を読み込めませんでした。",
    networkError: "通信に失敗しました。時間をおいて再度お試しください。",
    saveSuccess: "会員情報を保存しました。",
    saveError: "会員情報を保存できませんでした。",
    duplicatePhone: "この電話番号はすでに別の会員で使われています。",
    birthdayError: "生年月日を正しく入力してください。",
    requiredDisplayName: "表示名・ニックネーム",
    requiredLastName: "姓",
    requiredFirstName: "名",
    requiredPhone: "電話番号",
    requiredMessage: "{{fields}}を入力してください。"
  },
  zh: {
    member: "会员",
    notConfiguredTitle: "Clerk 环境变量尚未设置。",
    notConfiguredBody: "请设置 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 和 `CLERK_SECRET_KEY`。",
    accountMenuLabel: "会员菜单",
    loggedIn: "已登录",
    memberNumber: "会员编号",
    backToCard: "返回会员卡",
    orderHistory: "购买记录・收据",
    signOut: "退出登录",
    eyebrow: "账号设置",
    title: "会员信息",
    subtitle: "这里的信息会用于店头会员确认和预约时的自动填写。",
    authTitle: "登录会员信息",
    authDescription: "我们会向邮箱发送验证码，登录后即可编辑会员信息。",
    panelTitle: "会员信息",
    completeTitle: "请完成会员注册",
    completeBody: "使用积分和预约自动填写需要显示名、姓名和电话号码。",
    loading: "正在读取会员信息。",
    note: "显示名、姓名、电话号码用于会员确认。其他项目可选填写。",
    displayName: "显示名・昵称",
    displayNamePlaceholder: "例：Maamaa fan",
    lastName: "姓",
    lastNamePlaceholder: "例：王",
    firstName: "名",
    firstNamePlaceholder: "例：小明",
    lastNameKana: "姓氏假名（可选）",
    lastNameKanaPlaceholder: "例：ヤマダ",
    firstNameKana: "名字假名（可选）",
    firstNameKanaPlaceholder: "例：タロウ",
    phone: "电话号码",
    phonePart1: "电话号码 1",
    phonePart2: "电话号码 2",
    phonePart3: "电话号码 3",
    birthday: "生日（可选）",
    preferredStore: "常用门店（可选）",
    preferredLanguage: "显示语言（可选）",
    unset: "未设置",
    marketingOptIn: "接收优惠券和活动通知",
    lineLinked: "记录为已绑定 LINE（正式绑定功能准备中）",
    save: "保存会员信息",
    saving: "保存中...",
    loadError: "无法读取会员信息。",
    networkError: "通信失败。请稍后再试。",
    saveSuccess: "会员信息已保存。",
    saveError: "无法保存会员信息。",
    duplicatePhone: "这个电话号码已经被其他会员使用。",
    birthdayError: "请正确输入生日。",
    requiredDisplayName: "显示名・昵称",
    requiredLastName: "姓",
    requiredFirstName: "名",
    requiredPhone: "电话号码",
    requiredMessage: "请输入{{fields}}。"
  },
  "zh-Hant": {
    member: "會員",
    notConfiguredTitle: "Clerk 環境變數尚未設定。",
    notConfiguredBody: "請設定 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 和 `CLERK_SECRET_KEY`。",
    accountMenuLabel: "會員選單",
    loggedIn: "已登入",
    memberNumber: "會員編號",
    backToCard: "返回會員卡",
    orderHistory: "購買紀錄・收據",
    signOut: "登出",
    eyebrow: "帳號設定",
    title: "會員資訊",
    subtitle: "這裡的資訊會用於店頭會員確認與預約時的自動填入。",
    authTitle: "登入會員資訊",
    authDescription: "我們會寄送驗證碼到信箱，登入後即可編輯會員資訊。",
    panelTitle: "會員資訊",
    completeTitle: "請完成會員註冊",
    completeBody: "使用點數與預約自動填入需要顯示名稱、姓名和電話號碼。",
    loading: "正在讀取會員資訊。",
    note: "顯示名稱、姓名、電話號碼會用於會員確認。其他項目可選填。",
    displayName: "顯示名稱・暱稱",
    displayNamePlaceholder: "例：Maamaa fan",
    lastName: "姓",
    lastNamePlaceholder: "例：王",
    firstName: "名",
    firstNamePlaceholder: "例：小明",
    lastNameKana: "姓氏假名（選填）",
    lastNameKanaPlaceholder: "例：ヤマダ",
    firstNameKana: "名字假名（選填）",
    firstNameKanaPlaceholder: "例：タロウ",
    phone: "電話號碼",
    phonePart1: "電話號碼 1",
    phonePart2: "電話號碼 2",
    phonePart3: "電話號碼 3",
    birthday: "生日（選填）",
    preferredStore: "常用門店（選填）",
    preferredLanguage: "顯示語言（選填）",
    unset: "未設定",
    marketingOptIn: "接收優惠券與活動通知",
    lineLinked: "記錄為已綁定 LINE（正式綁定功能準備中）",
    save: "儲存會員資訊",
    saving: "儲存中...",
    loadError: "無法讀取會員資訊。",
    networkError: "通訊失敗。請稍後再試。",
    saveSuccess: "會員資訊已儲存。",
    saveError: "無法儲存會員資訊。",
    duplicatePhone: "這個電話號碼已被其他會員使用。",
    birthdayError: "請正確輸入生日。",
    requiredDisplayName: "顯示名稱・暱稱",
    requiredLastName: "姓",
    requiredFirstName: "名",
    requiredPhone: "電話號碼",
    requiredMessage: "請輸入{{fields}}。"
  },
  en: {
    member: "Member",
    notConfiguredTitle: "Clerk environment variables are not configured.",
    notConfiguredBody: "Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.",
    accountMenuLabel: "Member menu",
    loggedIn: "Signed in",
    memberNumber: "Member No.",
    backToCard: "Back to member card",
    orderHistory: "Orders and receipts",
    signOut: "Sign out",
    eyebrow: "Account Settings",
    title: "Member Information",
    subtitle: "This information is used for in-store member checks and reservation autofill.",
    authTitle: "Sign in to member information",
    authDescription: "We will send a verification code to your email so you can edit member information.",
    panelTitle: "Member Information",
    completeTitle: "Complete your member registration",
    completeBody: "Display name, full name, and phone number are required for points and reservation autofill.",
    loading: "Loading member information.",
    note: "Display name, full name, and phone number are required for member checks. Other fields are optional.",
    displayName: "Display name / nickname",
    displayNamePlaceholder: "Ex: Maamaa fan",
    lastName: "Last name",
    lastNamePlaceholder: "Ex: Yamada",
    firstName: "First name",
    firstNamePlaceholder: "Ex: Taro",
    lastNameKana: "Last name kana (optional)",
    lastNameKanaPlaceholder: "Ex: ヤマダ",
    firstNameKana: "First name kana (optional)",
    firstNameKanaPlaceholder: "Ex: タロウ",
    phone: "Phone number",
    phonePart1: "Phone number 1",
    phonePart2: "Phone number 2",
    phonePart3: "Phone number 3",
    birthday: "Birthday (optional)",
    preferredStore: "Preferred store (optional)",
    preferredLanguage: "Display language (optional)",
    unset: "Not set",
    marketingOptIn: "Receive coupon and campaign notifications",
    lineLinked: "Record LINE as linked (full integration coming soon)",
    save: "Save member information",
    saving: "Saving...",
    loadError: "Could not load member information.",
    networkError: "Network request failed. Please try again later.",
    saveSuccess: "Member information saved.",
    saveError: "Could not save member information.",
    duplicatePhone: "This phone number is already used by another member.",
    birthdayError: "Enter a valid birthday.",
    requiredDisplayName: "display name / nickname",
    requiredLastName: "last name",
    requiredFirstName: "first name",
    requiredPhone: "phone number",
    requiredMessage: "Please enter {{fields}}."
  },
  ko: {
    member: "회원",
    notConfiguredTitle: "Clerk 환경 변수가 설정되지 않았습니다.",
    notConfiguredBody: "`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 및 `CLERK_SECRET_KEY`를 설정하세요.",
    accountMenuLabel: "회원 메뉴",
    loggedIn: "로그인 중",
    memberNumber: "회원 번호",
    backToCard: "회원 카드로 돌아가기",
    orderHistory: "구매 내역・영수증",
    signOut: "로그아웃",
    eyebrow: "계정 설정",
    title: "회원 정보",
    subtitle: "매장 회원 확인과 예약 자동 입력에 사용할 정보를 설정할 수 있습니다.",
    authTitle: "회원 정보 로그인",
    authDescription: "이메일로 인증 코드를 보내 회원 정보를 편집할 수 있습니다.",
    panelTitle: "회원 정보",
    completeTitle: "회원 등록을 완료해 주세요",
    completeBody: "포인트 사용과 예약 자동 입력에는 표시 이름, 성명, 전화번호가 필요합니다.",
    loading: "회원 정보를 불러오는 중입니다.",
    note: "표시 이름, 성명, 전화번호는 회원 확인에 필요합니다. 다른 항목은 선택 사항입니다.",
    displayName: "표시 이름・닉네임",
    displayNamePlaceholder: "예: Maamaa fan",
    lastName: "성",
    lastNamePlaceholder: "예: Yamada",
    firstName: "이름",
    firstNamePlaceholder: "예: Taro",
    lastNameKana: "성 가나 (선택)",
    lastNameKanaPlaceholder: "예: ヤマダ",
    firstNameKana: "이름 가나 (선택)",
    firstNameKanaPlaceholder: "예: タロウ",
    phone: "전화번호",
    phonePart1: "전화번호 1",
    phonePart2: "전화번호 2",
    phonePart3: "전화번호 3",
    birthday: "생년월일 (선택)",
    preferredStore: "자주 이용하는 매장 (선택)",
    preferredLanguage: "표시 언어 (선택)",
    unset: "미설정",
    marketingOptIn: "쿠폰 및 캠페인 알림 받기",
    lineLinked: "LINE 연동 완료로 기록 (정식 연동 기능 준비 중)",
    save: "회원 정보 저장",
    saving: "저장 중...",
    loadError: "회원 정보를 불러올 수 없습니다.",
    networkError: "통신에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    saveSuccess: "회원 정보를 저장했습니다.",
    saveError: "회원 정보를 저장할 수 없습니다.",
    duplicatePhone: "이 전화번호는 이미 다른 회원이 사용 중입니다.",
    birthdayError: "생년월일을 올바르게 입력해 주세요.",
    requiredDisplayName: "표시 이름・닉네임",
    requiredLastName: "성",
    requiredFirstName: "이름",
    requiredPhone: "전화번호",
    requiredMessage: "{{fields}}을/를 입력해 주세요."
  },
  vi: {
    member: "Thành viên",
    notConfiguredTitle: "Chưa thiết lập biến môi trường Clerk.",
    notConfiguredBody: "Vui lòng thiết lập `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` và `CLERK_SECRET_KEY`.",
    accountMenuLabel: "Menu thành viên",
    loggedIn: "Đã đăng nhập",
    memberNumber: "Mã thành viên",
    backToCard: "Quay lại thẻ thành viên",
    orderHistory: "Lịch sử mua hàng・hóa đơn",
    signOut: "Đăng xuất",
    eyebrow: "Cài đặt tài khoản",
    title: "Thông tin thành viên",
    subtitle: "Thông tin này được dùng để xác nhận thành viên tại cửa hàng và tự động điền khi đặt trước.",
    authTitle: "Đăng nhập thông tin thành viên",
    authDescription: "Chúng tôi sẽ gửi mã xác minh đến email để bạn chỉnh sửa thông tin thành viên.",
    panelTitle: "Thông tin thành viên",
    completeTitle: "Vui lòng hoàn tất đăng ký thành viên",
    completeBody: "Cần tên hiển thị, họ tên và số điện thoại để dùng điểm và tự động điền khi đặt trước.",
    loading: "Đang tải thông tin thành viên.",
    note: "Tên hiển thị, họ tên và số điện thoại cần thiết để xác nhận thành viên. Các mục khác là tùy chọn.",
    displayName: "Tên hiển thị・biệt danh",
    displayNamePlaceholder: "VD: Maamaa fan",
    lastName: "Họ",
    lastNamePlaceholder: "VD: Nguyen",
    firstName: "Tên",
    firstNamePlaceholder: "VD: An",
    lastNameKana: "Kana họ (tùy chọn)",
    lastNameKanaPlaceholder: "VD: ヤマダ",
    firstNameKana: "Kana tên (tùy chọn)",
    firstNameKanaPlaceholder: "VD: タロウ",
    phone: "Số điện thoại",
    phonePart1: "Số điện thoại 1",
    phonePart2: "Số điện thoại 2",
    phonePart3: "Số điện thoại 3",
    birthday: "Ngày sinh (tùy chọn)",
    preferredStore: "Cửa hàng thường dùng (tùy chọn)",
    preferredLanguage: "Ngôn ngữ hiển thị (tùy chọn)",
    unset: "Chưa thiết lập",
    marketingOptIn: "Nhận thông báo phiếu giảm giá và khuyến mãi",
    lineLinked: "Ghi nhận là đã liên kết LINE (chức năng liên kết chính thức đang chuẩn bị)",
    save: "Lưu thông tin thành viên",
    saving: "Đang lưu...",
    loadError: "Không thể tải thông tin thành viên.",
    networkError: "Kết nối thất bại. Vui lòng thử lại sau.",
    saveSuccess: "Đã lưu thông tin thành viên.",
    saveError: "Không thể lưu thông tin thành viên.",
    duplicatePhone: "Số điện thoại này đã được thành viên khác sử dụng.",
    birthdayError: "Vui lòng nhập ngày sinh hợp lệ.",
    requiredDisplayName: "tên hiển thị・biệt danh",
    requiredLastName: "họ",
    requiredFirstName: "tên",
    requiredPhone: "số điện thoại",
    requiredMessage: "Vui lòng nhập {{fields}}."
  },
  ne: {
    member: "सदस्य",
    notConfiguredTitle: "Clerk का वातावरण चर सेट गरिएको छैन।",
    notConfiguredBody: "`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` र `CLERK_SECRET_KEY` सेट गर्नुहोस्।",
    accountMenuLabel: "सदस्य मेनु",
    loggedIn: "लगइन गरिएको",
    memberNumber: "सदस्य नम्बर",
    backToCard: "सदस्य कार्डमा फर्कनुहोस्",
    orderHistory: "खरिद इतिहास・रसिद",
    signOut: "लगआउट",
    eyebrow: "खाता सेटिङ",
    title: "सदस्य जानकारी",
    subtitle: "यो जानकारी पसलमा सदस्य पुष्टि र रिजर्भेसन गर्दा स्वतः भर्न प्रयोग हुन्छ।",
    authTitle: "सदस्य जानकारीमा लगइन",
    authDescription: "सदस्य जानकारी सम्पादन गर्न हामी इमेलमा प्रमाणीकरण कोड पठाउँछौं।",
    panelTitle: "सदस्य जानकारी",
    completeTitle: "सदस्य दर्ता पूरा गर्नुहोस्",
    completeBody: "पोइन्ट प्रयोग र रिजर्भेसन स्वतः भर्नका लागि प्रदर्शन नाम, पूरा नाम र फोन नम्बर आवश्यक छ।",
    loading: "सदस्य जानकारी पढ्दैछ।",
    note: "प्रदर्शन नाम, पूरा नाम र फोन नम्बर सदस्य पुष्टि गर्न आवश्यक छन्। अन्य वस्तुहरू वैकल्पिक हुन्।",
    displayName: "प्रदर्शन नाम・उपनाम",
    displayNamePlaceholder: "उदाहरण: Maamaa fan",
    lastName: "थर",
    lastNamePlaceholder: "उदाहरण: Shrestha",
    firstName: "नाम",
    firstNamePlaceholder: "उदाहरण: Sita",
    lastNameKana: "थर काना (वैकल्पिक)",
    lastNameKanaPlaceholder: "उदाहरण: ヤマダ",
    firstNameKana: "नाम काना (वैकल्पिक)",
    firstNameKanaPlaceholder: "उदाहरण: タロウ",
    phone: "फोन नम्बर",
    phonePart1: "फोन नम्बर 1",
    phonePart2: "फोन नम्बर 2",
    phonePart3: "फोन नम्बर 3",
    birthday: "जन्मदिन (वैकल्पिक)",
    preferredStore: "प्रायः प्रयोग गर्ने पसल (वैकल्पिक)",
    preferredLanguage: "प्रदर्शन भाषा (वैकल्पिक)",
    unset: "सेट गरिएको छैन",
    marketingOptIn: "कुपन र अभियान सूचना प्राप्त गर्ने",
    lineLinked: "LINE जोडिएको रूपमा रेकर्ड गर्ने (पूर्ण जोड्ने सुविधा तयारीमा छ)",
    save: "सदस्य जानकारी सुरक्षित गर्नुहोस्",
    saving: "सुरक्षित गर्दै...",
    loadError: "सदस्य जानकारी पढ्न सकिएन।",
    networkError: "सञ्चार असफल भयो। कृपया पछि फेरि प्रयास गर्नुहोस्।",
    saveSuccess: "सदस्य जानकारी सुरक्षित गरियो।",
    saveError: "सदस्य जानकारी सुरक्षित गर्न सकिएन।",
    duplicatePhone: "यो फोन नम्बर अर्को सदस्यले प्रयोग गरिसकेको छ।",
    birthdayError: "कृपया सही जन्मदिन प्रविष्ट गर्नुहोस्।",
    requiredDisplayName: "प्रदर्शन नाम・उपनाम",
    requiredLastName: "थर",
    requiredFirstName: "नाम",
    requiredPhone: "फोन नम्बर",
    requiredMessage: "कृपया {{fields}} प्रविष्ट गर्नुहोस्।"
  }
};

type MemberSettingsLanguage = keyof typeof memberSettingsText;

function normalizeSettingsLanguage(value: string): MemberSettingsLanguage {
  return value in memberSettingsText ? value as MemberSettingsLanguage : "ja";
}

function splitJapanesePhone(value: string) {
  const hyphenParts = value.split("-").map((part) => part.replace(/[^\d]/g, "")).filter(Boolean);
  if (hyphenParts.length === 3) return hyphenParts as [string, string, string];

  const digits = value.replace(/[^\d]/g, "");
  if (/^0[789]0\d{8}$/.test(digits)) return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7)];
  if (/^(0120\d{6}|0800\d{7})$/.test(digits)) return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)];
  if (/^0\d{9}$/.test(digits)) return [digits.slice(0, 2), digits.slice(2, 6), digits.slice(6)];
  if (/^0\d{8}$/.test(digits)) return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5)];
  return [digits, "", ""];
}

function composeJapanesePhone(part1: string, part2: string, part3: string) {
  return [part1, part2, part3].map((part) => part.replace(/[^\d]/g, "")).filter(Boolean).join("-");
}

function toSettingsForm(member?: MemberProfile | null): MemberSettingsForm {
  if (!member) return emptyMemberSettings;
  const [fallbackLastName = "", fallbackFirstName = ""] = (member.fullName || "").trim().split(/\s+/, 2);
  const [fallbackLastNameKana = "", fallbackFirstNameKana = ""] = (member.nameKana || "").trim().split(/\s+/, 2);
  const [phonePart1, phonePart2, phonePart3] = splitJapanesePhone(member.phone || "");
  return {
    displayName: member.displayName || "",
    lastName: member.lastName || fallbackLastName,
    firstName: member.firstName || fallbackFirstName,
    fullName: member.fullName || "",
    nameKana: member.nameKana || "",
    lastNameKana: fallbackLastNameKana,
    firstNameKana: fallbackFirstNameKana,
    phone: member.phone || "",
    phonePart1,
    phonePart2,
    phonePart3,
    birthday: member.birthday || "",
    preferredLanguage: member.preferredLanguage || "ja",
    preferredStoreId: member.preferredStoreId || "",
    marketingOptIn: Boolean(member.marketingOptIn),
    lineLinked: Boolean(member.lineLinked)
  };
}

function safeReturnTo(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return "";
  }
  return "";
}

function getAccountDisplayName(member?: MemberProfile | null, user?: { username?: string | null; primaryEmailAddress?: { emailAddress?: string | null } | null }, fallback = "会員") {
  return member?.displayName?.trim() || user?.username || user?.primaryEmailAddress?.emailAddress || fallback;
}

function settingsReturnUrl(returnTo: string, handoffEnabled: boolean) {
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  if (handoffEnabled) params.set("handoff", "1");
  const query = params.toString();
  return query ? `/member?${query}` : "/member";
}

export default function MemberSettingsPage() {
  const { language, syncPreferredLanguage } = useMemberLanguage();
  const { isLoaded, isSignedIn, user } = useUser();
  const [data, setData] = useState<MemberResponse>({});
  const [settingsForm, setSettingsForm] = useState<MemberSettingsForm>(emptyMemberSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [returnTo, setReturnTo] = useState("");
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [completeProfileRequested, setCompleteProfileRequested] = useState(false);
  const currentLanguage = normalizeSettingsLanguage(language);
  const text = memberSettingsText[currentLanguage];
  const preferredStoreOptions = useMemo(() => [
    { value: "", label: text.unset },
    ...(data.preferredStoreOptions ?? [])
  ], [data.preferredStoreOptions, text.unset]);

  const afterAuthUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (returnTo) params.set("returnTo", returnTo);
    if (handoffEnabled) params.set("handoff", "1");
    if (completeProfileRequested) params.set("completeProfile", "1");
    const query = params.toString();
    return query ? `/member/settings?${query}` : "/member/settings";
  }, [completeProfileRequested, handoffEnabled, returnTo]);

  async function loadMemberSettings() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/public/members/me", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as MemberResponse;
      if (!response.ok) {
        setMessage(body.error || text.loadError);
        setData({});
        return;
      }
      setData(body);
      syncPreferredLanguage(body.member?.preferredLanguage);
      setSettingsForm(toSettingsForm(body.member));
    } catch {
      setMessage(text.networkError);
      setData({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnTo(safeReturnTo(params.get("returnTo") || ""));
    setHandoffEnabled(params.get("handoff") === "1");
    setCompleteProfileRequested(params.get("completeProfile") === "1");
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadMemberSettings();
  }, [isLoaded, isSignedIn]);

  async function saveSettings(form = settingsForm) {
    const requiredMissing = [
      !form.displayName.trim() ? text.requiredDisplayName : "",
      !form.lastName.trim() ? text.requiredLastName : "",
      !form.firstName.trim() ? text.requiredFirstName : "",
      !(form.phonePart1.trim() && form.phonePart2.trim() && form.phonePart3.trim()) ? text.requiredPhone : ""
    ].filter(Boolean);
    if (requiredMissing.length) {
      setMessage(text.requiredMessage.replace("{{fields}}", requiredMissing.join(currentLanguage === "en" ? ", " : "、")));
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const nameKana = [form.lastNameKana, form.firstNameKana].map((part) => part.trim()).filter(Boolean).join(" ");
      const phone = composeJapanesePhone(form.phonePart1, form.phonePart2, form.phonePart3);
      const response = await fetch("/api/public/members/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, nameKana, phone, preferredLanguage: language })
      });
      const body = await response.json().catch(() => ({})) as MemberResponse;
      if (!response.ok) throw new Error(body.error || text.saveError);
      setData((current) => ({
        ...current,
        member: body.member ?? current.member,
        preferredStoreOptions: body.preferredStoreOptions ?? current.preferredStoreOptions
      }));
      setSettingsForm(toSettingsForm(body.member));
      if (completeProfileRequested || handoffEnabled) {
        window.location.href = settingsReturnUrl(returnTo, handoffEnabled);
        return;
      }
      setMessage(text.saveSuccess);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : text.saveError;
      const localizedMessage = rawMessage === "この電話番号はすでに別の会員で使われています。"
        ? text.duplicatePhone
        : rawMessage === "生年月日を正しく入力してください。"
          ? text.birthdayError
          : rawMessage;
      setMessage(localizedMessage || text.saveError);
    } finally {
      setSaving(false);
    }
  }

  if (!clerkConfigured) {
    return (
      <main className="member-portal-page">
        <header className="member-portal-topbar">
          <a className="member-portal-brand" href="/member" aria-label="Foundr1 Members">
            <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
            <strong>{text.member}</strong>
          </a>
          <MemberLanguageSwitcher />
        </header>
        <section className="member-portal-config">
          <strong>{text.notConfiguredTitle}</strong>
          <p>{text.notConfiguredBody}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="member-portal-page">
      <header className="member-portal-topbar">
        <a className="member-portal-brand" href="/member" aria-label="Foundr1 Members">
          <span><img src="/icons/foundr1-store-512.png" alt="Foundr1" /></span>
          <strong>{text.member}</strong>
        </a>
        <div className="member-topbar-actions">
          <MemberLanguageSwitcher />
        {isSignedIn ? (
          <details className="member-account-menu">
            <summary aria-label={text.accountMenuLabel}>
              <span className="member-account-avatar"><UserRound size={18} /></span>
              <span className="member-account-summary-text">
                <strong>{getAccountDisplayName(data.member, user, text.member)}</strong>
                <small>{data.member?.memberNumber || user?.primaryEmailAddress?.emailAddress || text.loggedIn}</small>
              </span>
              <ChevronDown size={16} />
            </summary>
            <div className="member-account-popover">
              <div className="member-account-card">
                <span>{text.loggedIn}</span>
                <strong>{getAccountDisplayName(data.member, user, text.member)}</strong>
                {data.member?.memberNumber ? <small>{text.memberNumber} {data.member.memberNumber}</small> : null}
              </div>
              <a className="member-account-menu-item" href="/member">
                <Home size={16} />
                {text.backToCard}
              </a>
              <a className="member-account-menu-item" href="/member/orders">
                <ShoppingBag size={16} />
                {text.orderHistory}
              </a>
              <SignOutButton redirectUrl="/member?loggedOut=1">
                <button className="member-account-menu-item" type="button">
                  <LogOut size={16} />
                  {text.signOut}
                </button>
              </SignOutButton>
            </div>
          </details>
        ) : null}
        </div>
      </header>

      <section className="member-portal-hero member-orders-hero">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
          <span>{text.subtitle}</span>
        </div>
      </section>

      {isLoaded && !isSignedIn ? (
        <MemberAuthPanel
          title={text.authTitle}
          description={text.authDescription}
          afterAuthUrl={afterAuthUrl}
        />
      ) : null}

      {isLoaded && isSignedIn ? (
        <section className="member-settings-page-shell">
          <article className="member-portal-panel member-settings-panel is-profile-task">
            <div className="member-settings-summary member-settings-page-title">
              <div className="member-portal-panel-title">
                <Settings size={18} />
                <h3>{text.panelTitle}</h3>
              </div>
              <a className="secondary-button" href="/member">
                <Home size={16} />
                {text.backToCard}
              </a>
            </div>
            <div className="member-settings-body">
              {completeProfileRequested ? (
                <div className="member-settings-required-alert">
                  <strong>{text.completeTitle}</strong>
                  <span>{text.completeBody}</span>
                </div>
              ) : null}
              {loading ? <p className="member-settings-inline-message">{text.loading}</p> : null}
              {message ? <p className="member-settings-inline-message">{message}</p> : null}
              <p className="member-settings-note">{text.note}</p>
              <div className="member-settings-grid">
                <label className="member-settings-field-wide">
                  <span>{text.displayName}</span>
                  <input value={settingsForm.displayName} onChange={(event) => setSettingsForm((current) => ({ ...current, displayName: event.target.value }))} placeholder={text.displayNamePlaceholder} disabled={loading || saving} />
                </label>
                <label className="member-settings-field-name">
                  <span>{text.lastName}</span>
                  <input value={settingsForm.lastName} onChange={(event) => setSettingsForm((current) => ({ ...current, lastName: event.target.value, fullName: [event.target.value, current.firstName].filter(Boolean).join(" ") }))} placeholder={text.lastNamePlaceholder} autoComplete="family-name" disabled={loading || saving} required />
                </label>
                <label className="member-settings-field-name">
                  <span>{text.firstName}</span>
                  <input value={settingsForm.firstName} onChange={(event) => setSettingsForm((current) => ({ ...current, firstName: event.target.value, fullName: [current.lastName, event.target.value].filter(Boolean).join(" ") }))} placeholder={text.firstNamePlaceholder} autoComplete="given-name" disabled={loading || saving} required />
                </label>
                <label className="member-settings-field-kana">
                  <span>{text.lastNameKana}</span>
                  <input value={settingsForm.lastNameKana} onChange={(event) => setSettingsForm((current) => ({ ...current, lastNameKana: event.target.value, nameKana: [event.target.value, current.firstNameKana].filter(Boolean).join(" ") }))} placeholder={text.lastNameKanaPlaceholder} autoComplete="section-kana family-name" disabled={loading || saving} />
                </label>
                <label className="member-settings-field-kana">
                  <span>{text.firstNameKana}</span>
                  <input value={settingsForm.firstNameKana} onChange={(event) => setSettingsForm((current) => ({ ...current, firstNameKana: event.target.value, nameKana: [current.lastNameKana, event.target.value].filter(Boolean).join(" ") }))} placeholder={text.firstNameKanaPlaceholder} autoComplete="section-kana given-name" disabled={loading || saving} />
                </label>
                <label>
                  <span>{text.phone}</span>
                  <div className="member-phone-segments">
                    <input value={settingsForm.phonePart1} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart1: event.target.value.replace(/[^\d]/g, "").slice(0, 5), phone: composeJapanesePhone(event.target.value, current.phonePart2, current.phonePart3) }))} placeholder="090" inputMode="numeric" autoComplete="tel-area-code" aria-label={text.phonePart1} disabled={loading || saving} required />
                    <span>-</span>
                    <input value={settingsForm.phonePart2} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart2: event.target.value.replace(/[^\d]/g, "").slice(0, 4), phone: composeJapanesePhone(current.phonePart1, event.target.value, current.phonePart3) }))} placeholder="1234" inputMode="numeric" autoComplete="tel-local-prefix" aria-label={text.phonePart2} disabled={loading || saving} required />
                    <span>-</span>
                    <input value={settingsForm.phonePart3} onChange={(event) => setSettingsForm((current) => ({ ...current, phonePart3: event.target.value.replace(/[^\d]/g, "").slice(0, 4), phone: composeJapanesePhone(current.phonePart1, current.phonePart2, event.target.value) }))} placeholder="5678" inputMode="numeric" autoComplete="tel-local-suffix" aria-label={text.phonePart3} disabled={loading || saving} required />
                  </div>
                </label>
                <label>
                  <span>{text.birthday}</span>
                  <input type="date" value={settingsForm.birthday} onChange={(event) => setSettingsForm((current) => ({ ...current, birthday: event.target.value }))} disabled={loading || saving} />
                </label>
                <label>
                  <span>{text.preferredStore}</span>
                  <select value={settingsForm.preferredStoreId} onChange={(event) => setSettingsForm((current) => ({ ...current, preferredStoreId: event.target.value }))} disabled={loading || saving}>
                    {preferredStoreOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="member-settings-checks">
                <label>
                  <input type="checkbox" checked={settingsForm.marketingOptIn} onChange={(event) => setSettingsForm((current) => ({ ...current, marketingOptIn: event.target.checked }))} disabled={loading || saving} />
                  <span>{text.marketingOptIn}</span>
                </label>
                <label>
                  <input type="checkbox" checked={settingsForm.lineLinked} onChange={(event) => setSettingsForm((current) => ({ ...current, lineLinked: event.target.checked }))} disabled={loading || saving} />
                  <span>{text.lineLinked}</span>
                </label>
              </div>
              <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={loading || saving}>
                {saving ? <Loader2 size={16} /> : <Save size={16} />}
                {saving ? text.saving : text.save}
              </button>
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
