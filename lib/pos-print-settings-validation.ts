import { normalizePosPrinterSettings, type PosPrinterSettings } from './pos-printer';

export type PosPrintingSettingsPatch = Pick<PosPrinterSettings, 'enabled' | 'receiptEnabled' | 'receiptCopies' | 'bowlTickets'>
  & Partial<Pick<PosPrinterSettings, 'receiptTemplate' | 'receiptTemplateVariants'>>;
const bowlBlocks = ['title', 'store', 'pickup', 'orderType', 'items', 'note', 'message', 'timestamp'];
const receiptBlocks = ['logo', 'business', 'contact', 'message', 'receipt', 'promotion', 'qr', 'footer'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key);
const copyCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 5;
const string = (value: unknown, maximum: number, required = false) => typeof value === 'string'
  && value.trim().length <= maximum && (!required || Boolean(value.trim())) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const enumeration = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value);
function order(value: unknown, blocks: string[]) {
  return Array.isArray(value) && value.length === blocks.length && new Set(value).size === value.length
    && value.every(block => typeof block === 'string' && blocks.includes(block));
}
function kitchenTemplate(value: unknown): boolean {
  if (!object(value)) return false;
  const booleans = ['showTitle', 'showStoreName', 'showPickupCode', 'showOrderType', 'showItems', 'showOptions', 'showNote', 'showTimestamp', 'showAmounts', 'largeText'];
  const allowed = new Set([...booleans, 'language', 'title', 'customMessage', 'blockOrder', 'blockStyles']);
  if (Object.keys(value).some(key => !allowed.has(key)) || booleans.some(key => own(value, key) && typeof value[key] !== 'boolean')) return false;
  if (own(value, 'language') && !enumeration(value.language, ['ja', 'zh'])
    || own(value, 'title') && !string(value.title, 80, true)
    || own(value, 'customMessage') && !string(value.customMessage, 240)
    || own(value, 'blockOrder') && !order(value.blockOrder, bowlBlocks)) return false;
  if (own(value, 'blockStyles')) {
    if (!object(value.blockStyles) || Object.keys(value.blockStyles).some(key => !bowlBlocks.includes(key))) return false;
    for (const style of Object.values(value.blockStyles)) {
      if (!object(style) || Object.keys(style).some(key => !['textSize', 'alignment', 'bold', 'separatorBefore'].includes(key))) return false;
      if (own(style, 'textSize') && !enumeration(style.textSize, ['small', 'standard', 'large', 'xlarge'])
        || own(style, 'alignment') && !enumeration(style.alignment, ['left', 'center'])
        || ['bold', 'separatorBefore'].some(key => own(style, key) && typeof style[key] !== 'boolean')) return false;
    }
  }
  return true;
}
function receiptTemplate(value: unknown): boolean {
  if (!object(value)) return false;
  const booleans = ['showLogo', 'qrCodeEnabled', 'showTaxSummary', 'showOrderNote', 'showTimestamp'];
  const strings: Record<string, number> = { logoUrl: 500, promotionImageUrl: 500, receiptTitle: 80, invoiceTitle: 80,
    invoiceRecipientName: 120, invoicePurposeText: 120, businessName: 120, companyInfo: 500, taxRegistrationNumber: 80,
    phone: 80, address: 240, website: 160, headerMessage: 500, footerMessage: 500, promotionMessage: 500, qrCodeUrl: 500, qrCodeLabel: 160 };
  const alignments = ['logoAlignment', 'promotionImageAlignment', 'businessNameAlignment', 'contactInfoAlignment', 'messageAlignment', 'qrCodeAlignment'];
  const sizes = ['businessNameTextSize', 'titleTextSize', 'messageTextSize'];
  const numbers: Record<string, [number, number]> = { logoWidthPercent: [20, 100], logoBottomSpacing: [0, 40], promotionImageWidthPercent: [20, 100] };
  const allowed = new Set([...booleans, ...Object.keys(strings), ...alignments, ...sizes, ...Object.keys(numbers), 'density', 'blockOrder', 'qrCodeSize']);
  if (Object.keys(value).some(key => !allowed.has(key)) || booleans.some(key => own(value, key) && typeof value[key] !== 'boolean')) return false;
  if (Object.entries(strings).some(([key, limit]) => own(value, key) && !string(value[key], limit, ['receiptTitle', 'invoiceTitle', 'invoiceRecipientName', 'invoicePurposeText'].includes(key)))) return false;
  if (alignments.some(key => own(value, key) && !enumeration(value[key], ['left', 'center']))
    || sizes.some(key => own(value, key) && !enumeration(value[key], ['small', 'standard', 'large']))) return false;
  if (Object.entries(numbers).some(([key, [min, max]]) => own(value, key) && (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || Number(value[key]) < min || Number(value[key]) > max))) return false;
  return !(own(value, 'density') && !enumeration(value.density, ['standard', 'compact'])
    || own(value, 'qrCodeSize') && !enumeration(value.qrCodeSize, ['small', 'medium', 'large'])
    || own(value, 'blockOrder') && !order(value.blockOrder, receiptBlocks));
}
/** Validate new explicit editor writes before normalization can silently drop,
 * clamp or coerce malformed settings. Unowned printer fields are never saved. */
export function validatePosPrintingSettings(value: unknown): { settings?: PosPrintingSettingsPatch; error?: string } {
  const invalid = { error: '印刷・伝票の設定を確認してください。' };
  if (!object(value) || typeof value.enabled !== 'boolean' || typeof value.receiptEnabled !== 'boolean'
    || !copyCount(value.receiptCopies) || !object(value.bowlTickets)
    || Object.keys(value.bowlTickets).some(key => !['kitchen', 'finishing', 'pickup'].includes(key))) return invalid;
  for (const kind of ['kitchen', 'finishing', 'pickup']) {
    const role = value.bowlTickets[kind];
    if (!object(role) || Object.keys(role).some(key => !['enabled', 'copies', 'template', 'templateVariants'].includes(key))
      || typeof role.enabled !== 'boolean' || !copyCount(role.copies)
      || own(role, 'template') && role.template !== null && !kitchenTemplate(role.template)) return invalid;
    if (own(role, 'templateVariants')) {
      if (!Array.isArray(role.templateVariants) || role.templateVariants.length > 30) return invalid;
      const seen = new Set<string>();
      for (const variant of role.templateVariants) {
        if (!object(variant) || Object.keys(variant).some(key => !['brandId', 'brandName', 'template'].includes(key))
          || typeof variant.brandId !== 'string' || !uuid.test(variant.brandId) || seen.has(variant.brandId.toLowerCase())
          || own(variant, 'brandName') && !string(variant.brandName, 120) || !kitchenTemplate(variant.template)) return invalid;
        seen.add(variant.brandId.toLowerCase());
      }
    }
  }
  if (own(value, 'receiptTemplate') && !receiptTemplate(value.receiptTemplate)) return invalid;
  if (own(value, 'receiptTemplateVariants')) {
    if (!Array.isArray(value.receiptTemplateVariants) || value.receiptTemplateVariants.length > 60) return invalid;
    const seen = new Set<string>();
    for (const variant of value.receiptTemplateVariants) {
      if (!object(variant) || Object.keys(variant).some(key => !['brandId', 'brandName', 'documentType', 'template'].includes(key))
        || typeof variant.brandId !== 'string' || variant.brandId !== '' && !uuid.test(variant.brandId)
        || own(variant, 'brandName') && !string(variant.brandName, 120)
        || !enumeration(variant.documentType, ['receipt', 'invoice']) || !receiptTemplate(variant.template)) return invalid;
      const key = `${variant.brandId.toLowerCase()}:${variant.documentType}`;
      if (seen.has(key)) return invalid;
      seen.add(key);
    }
  }
  const normalized = normalizePosPrinterSettings({ enabled: value.enabled, receiptEnabled: value.receiptEnabled,
    receiptCopies: value.receiptCopies, bowlTickets: value.bowlTickets,
    ...(own(value, 'receiptTemplate') ? { receiptTemplate: value.receiptTemplate } : {}),
    ...(own(value, 'receiptTemplateVariants') ? { receiptTemplateVariants: value.receiptTemplateVariants } : {}) });
  return { settings: { enabled: normalized.enabled, receiptEnabled: normalized.receiptEnabled,
    receiptCopies: normalized.receiptCopies, bowlTickets: normalized.bowlTickets,
    ...(own(value, 'receiptTemplate') ? { receiptTemplate: normalized.receiptTemplate } : {}),
    ...(own(value, 'receiptTemplateVariants') ? { receiptTemplateVariants: normalized.receiptTemplateVariants } : {}) } };
}
