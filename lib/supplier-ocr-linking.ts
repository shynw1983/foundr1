import { sql } from "./db";

export type ReceiptSupplierLinkInput = {
  vendorName?: string;
  companyName?: string;
  brandName?: string;
  locationName?: string;
};

export type ReceiptSupplierLink = {
  supplierId: string;
  supplierLocationId: string;
  matchStatus: string;
};

type SupplierRow = {
  id: string;
  name: string;
  channelType: string;
};

type SupplierLocationRow = {
  id: string;
  supplierId: string;
  name: string;
};

export function normalizeSupplierOcrName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/近隣|最寄り|近くの/g, "")
    .replace(/[株式会社有限会社合同会社㈱㈲()（）・.,，。]/g, "")
    .trim();
}

export function buildSupplierDisplayName(input: ReceiptSupplierLinkInput) {
  return [input.brandName || input.companyName, input.locationName].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ")
    || String(input.vendorName ?? "").trim();
}

export async function resolveReceiptSupplierLink(input: ReceiptSupplierLinkInput): Promise<ReceiptSupplierLink> {
  const names = buildSupplierNameCandidates(input);
  const normalizedNames = names.map(normalizeSupplierOcrName).filter(Boolean);
  if (!normalizedNames.length) return emptySupplierLink();

  const [suppliers, locations] = await Promise.all([
    sql`
      select id::text, name, channel_type as "channelType"
      from suppliers
      where status = 'active'
      order by name
    `,
    sql`
      select id::text, supplier_id::text as "supplierId", name
      from supplier_locations
      order by name
    `
  ]);

  const locationMatch = findLocationMatch(locations as SupplierLocationRow[], normalizedNames);
  if (locationMatch) {
    return {
      supplierId: locationMatch.supplierId,
      supplierLocationId: locationMatch.id,
      matchStatus: "location_exact"
    };
  }

  const supplierMatch = findSupplierMatch(suppliers as SupplierRow[], normalizedNames);
  if (!supplierMatch) return emptySupplierLink();

  const locationName = String(input.locationName ?? "").trim();
  const supplierLocationId = locationName
    ? await ensureReceiptSupplierLocation(supplierMatch, locationName, String(input.vendorName ?? "").trim())
    : "";

  return {
    supplierId: supplierMatch.id,
    supplierLocationId,
    matchStatus: locationName ? "supplier_with_location" : "supplier_exact"
  };
}

function buildSupplierNameCandidates(input: ReceiptSupplierLinkInput) {
  return [
    input.vendorName,
    buildSupplierDisplayName(input),
    input.brandName,
    input.companyName
  ]
    .map((value) => String(value ?? "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function findLocationMatch(locations: SupplierLocationRow[], normalizedNames: string[]) {
  return locations.find((location) => {
    const normalizedLocation = normalizeSupplierOcrName(location.name);
    return normalizedNames.some((name) => name === normalizedLocation || name.endsWith(normalizedLocation));
  }) ?? null;
}

function findSupplierMatch(suppliers: SupplierRow[], normalizedNames: string[]) {
  return suppliers.find((supplier) => {
    const normalizedSupplier = normalizeSupplierOcrName(supplier.name);
    if (!normalizedSupplier) return false;
    return normalizedNames.some((name) => (
      name === normalizedSupplier
      || name.startsWith(normalizedSupplier)
      || name.includes(normalizedSupplier)
      || normalizedSupplier.includes(name)
    ));
  }) ?? null;
}

async function ensureReceiptSupplierLocation(supplier: SupplierRow, locationName: string, vendorName: string) {
  const existingRows = await sql`
    select id::text
    from supplier_locations
    where supplier_id::text = ${supplier.id}
      and name = ${locationName}
    limit 1
  `;
  if (existingRows[0]?.id) return String(existingRows[0].id);

  const rows = await sql`
    insert into supplier_locations (
      supplier_id,
      name,
      location_type,
      note
    )
    values (
      ${supplier.id},
      ${locationName},
      ${supplier.channelType || "実店舗"},
      ${vendorName ? `OCR商取引先から自動追加: ${vendorName}` : "OCR商取引先から自動追加"}
    )
    on conflict (supplier_id, name)
    do update set note = coalesce(nullif(supplier_locations.note, ''), excluded.note)
    returning id::text
  `;
  return String(rows[0]?.id ?? "");
}

function emptySupplierLink(): ReceiptSupplierLink {
  return {
    supplierId: "",
    supplierLocationId: "",
    matchStatus: "unmatched"
  };
}
