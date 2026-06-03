import { createCustomerOrder, createPickupCode, updateCustomerOrder } from "../../../../../../lib/customer-orders";
import { getMaamaaCompatibleMenu, type MaamaaMenuSection, type MaamaaPricedOption } from "../../../../../../lib/maamaa-compatible-menu";
import { getActiveStorePaymentAccount } from "../../../../../../lib/store-payment-accounts";
import { isPickupWithinBusinessHours } from "../../../../../../lib/store-business-hours";

export const dynamic = "force-dynamic";

function compareDateTime(dateA: string, timeA: string, dateB: string, timeB: string) {
  return `${dateA}T${timeA}`.localeCompare(`${dateB}T${timeB}`);
}

function getTokyoMinimumPickup() {
  const now = new Date();
  const minimum = new Date(now.getTime() + 5 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const [date, time] = formatter.format(minimum).split(" ");
  return { date, time };
}

function findChoice(items: MaamaaPricedOption[], id: string, required = true) {
  if (!id && !required) return null;
  return items.find((item) => item.id === id || item.name === id) ?? null;
}

function selectedIdsForSection(body: Record<string, unknown>, section: MaamaaMenuSection) {
  const selections = body.selections && typeof body.selections === "object" ? body.selections as Record<string, unknown> : {};
  const fromSelections = selections[section.id];
  const fromSections = body.sections && typeof body.sections === "object" ? (body.sections as Record<string, unknown>)[section.id] : undefined;
  const raw = fromSelections ?? fromSections ?? body[section.id] ?? [];
  return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
}

function komojuAuthHeader(secretKey: string) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request body" }, { status: 400 });

  const storeId = String(body.store || "");
  const pickupDate = String(body.pickupDate || "");
  const pickup = String(body.pickup || "");
  const completionUrl = String(body.completionUrl || "");
  const completionPath = String(body.completionPath || "/order-complete");
  const completionSummary = (body.completionSummary || {}) as Record<string, unknown>;

  const { brandId, baseMenu: menu } = await getMaamaaCompatibleMenu(storeId);
  const publicStore = menu.stores.find((store) => store.id === storeId || store.label === storeId || store.osStoreId === storeId) ?? (menu.stores.length === 1 ? menu.stores[0] : null);
  if (!publicStore) return Response.json({ error: "Unknown store" }, { status: 400 });
  const paymentAccount = await getActiveStorePaymentAccount({
    storeId: publicStore.osStoreId,
    provider: "komoju",
    allowFallback: true
  });
  if (!paymentAccount?.secretKey) {
    return Response.json({ code: "STORE_PAYMENT_NOT_CONFIGURED", error: "KOMOJU is not configured for this store." }, { status: 500 });
  }

  const operation = menu.storeOperation;
  if (!operation.reservationsEnabled) {
    return Response.json({ error: "Reservations are temporarily paused for this store" }, { status: 409 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || !/^\d{2}:\d{2}$/.test(pickup)) {
    return Response.json({ error: "Invalid pickup time" }, { status: 400 });
  }
  const minimumPickup = getTokyoMinimumPickup();
  if (compareDateTime(pickupDate, pickup, minimumPickup.date, minimumPickup.time) < 0) {
    return Response.json({ error: "Pickup time must be at least 5 minutes from now" }, { status: 400 });
  }
  if (!isPickupWithinBusinessHours(operation.businessHours, pickupDate, pickup)) {
    return Response.json({ error: "Pickup time is outside store business hours" }, { status: 409 });
  }

  const medicinalSpice = findChoice(menu.medicinalSpiceOptions, String(body.medicinalSpice || body.medicinalSpiceOption || ""), menu.medicinalSpiceOptions.length > 0);
  const heat = findChoice(menu.heatLevels, String(body.heat || body.heatLevel || ""), menu.heatLevels.length > 0);
  const numb = findChoice(menu.numbLevels, String(body.numb || body.numbLevel || ""), menu.numbLevels.length > 0);
  const specialFlavor = findChoice(menu.specialFlavors, String(body.specialFlavor || ""), false);

  if ((menu.medicinalSpiceOptions.length && !medicinalSpice) || (menu.heatLevels.length && !heat) || (menu.numbLevels.length && !numb)) {
    return Response.json({ error: "Invalid soup customization" }, { status: 400 });
  }

  let selectionError = "";
  const selectedSections = menu.menuSections.map((section) => {
    const ids = selectedIdsForSection(body, section);
    if (ids.length > section.limit) {
      selectionError = `${section.title} can only select up to ${section.limit}`;
      return { section, items: [] };
    }
    const items = ids.map((id) => findChoice(section.items, id, true));
    if (items.some((item) => !item)) {
      selectionError = `Invalid selection in ${section.title}`;
      return { section, items: [] };
    }
    return { section, items: items as MaamaaPricedOption[] };
  });
  if (selectionError) return Response.json({ error: selectionError }, { status: 400 });

  const optionItems = [medicinalSpice, heat, numb, specialFlavor].filter(Boolean) as MaamaaPricedOption[];
  const toppingItems = selectedSections.flatMap((section) => section.items);
  const amount = menu.baseSoup.price +
    optionItems.reduce((sum, item) => sum + item.price, 0) +
    toppingItems.reduce((sum, item) => sum + item.price, 0);
  if (amount <= 0) return Response.json({ error: "Invalid amount" }, { status: 400 });

  const pickupCode = createPickupCode("M");
  const customizationLabels = [
    medicinalSpice?.name,
    heat ? `辛さ: ${heat.name}` : "",
    numb ? `痺れ: ${numb.name}` : "",
    specialFlavor ? `味変: ${specialFlavor.name}` : ""
  ].filter(Boolean);
  const sectionLabels = selectedSections
    .filter((section) => section.items.length)
    .map(({ section, items }) => `${section.title}: ${items.map((item) => item.name).join(", ")}`);
  const detailLabel = [...customizationLabels, ...sectionLabels].join("\n");

  const localOrder = await createCustomerOrder({
    brandId,
    storeId: publicStore.osStoreId,
    orderSource: "maamaa_web",
    paymentProvider: "komoju",
    paymentAccountId: paymentAccount.id || undefined,
    pickupCode,
    pickupDate,
    pickupTime: pickup,
    amount,
    customerSummary: {
      ...completionSummary,
      brand: "maamaa",
      store: publicStore.label,
      paymentAccountName: paymentAccount.accountName,
      selections: selectedSections.map(({ section, items }) => ({
        sectionId: section.id,
        sectionTitle: section.title,
        items
      }))
    },
    drink: menu.baseSoup.name,
    size: detailLabel || "カスタマイズなし",
    temperature: heat?.name ?? "",
    sweetness: numb?.name ?? "",
    ice: medicinalSpice?.name ?? "",
    option: specialFlavor?.name ?? "",
    toppings: sectionLabels.join("\n") || "トッピングなし",
    items: [{
      menuCatalogItemId: menu.baseSoup.menuCatalogItemId,
      itemName: menu.baseSoup.name,
      sizeKey: "buildable",
      sizeLabel: detailLabel || "カスタマイズなし",
      temperature: heat?.name ?? "",
      sweetness: numb?.name ?? "",
      ice: medicinalSpice?.name ?? "",
      optionKey: specialFlavor?.id ?? "",
      optionLabel: specialFlavor?.name ?? "",
      toppingKeys: [...optionItems, ...toppingItems].map((item) => item.id),
      toppingLabels: [...optionItems, ...toppingItems].map((item) => item.name),
      amount
    }]
  });
  if (!localOrder) return Response.json({ error: "Order could not be created" }, { status: 500 });

  const redirectBase = completionUrl || new URL(completionPath, request.url).toString();
  const redirectUrl = new URL(redirectBase);
  redirectUrl.searchParams.set("orderId", localOrder.id);
  redirectUrl.searchParams.set("pickupCode", pickupCode);
  redirectUrl.searchParams.set("pickupDate", pickupDate);
  redirectUrl.searchParams.set("pickupTime", pickup);
  redirectUrl.searchParams.set("drink", String(completionSummary.drink || menu.baseSoup.name));
  redirectUrl.searchParams.set("size", String(completionSummary.size || detailLabel || "カスタマイズなし"));
  redirectUrl.searchParams.set("total", String(completionSummary.total || amount));

  const sessionPayload: Record<string, unknown> = {
    mode: "payment",
    amount,
    currency: "JPY",
    return_url: redirectUrl.toString(),
    default_locale: "ja",
    metadata: {
      orderId: localOrder.id,
      pickupCode,
      brand: "maamaa",
      storeId: publicStore.osStoreId,
      paymentAccountId: paymentAccount.id || ""
    },
    payment_data: {
      external_order_num: pickupCode,
      capture: "auto"
    }
  };
  if (paymentAccount.paymentTypes.length) sessionPayload.payment_types = paymentAccount.paymentTypes;

  const komojuResponse = await fetch("https://komoju.com/api/v1/sessions", {
    method: "POST",
    headers: {
      Authorization: komojuAuthHeader(paymentAccount.secretKey),
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(sessionPayload)
  });
  const komojuBody = await komojuResponse.json();
  if (!komojuResponse.ok) {
    await updateCustomerOrder(localOrder.id, { status: "checkout_failed", paymentStatus: "failed" });
    return Response.json({ code: "KOMOJU_SESSION_FAILED", error: "KOMOJU checkout could not be created", details: komojuBody }, { status: komojuResponse.status });
  }

  await updateCustomerOrder(localOrder.id, {
    paymentProvider: "komoju",
    paymentAccountId: paymentAccount.id || undefined,
    paymentSessionId: komojuBody.id || ""
  });

  return Response.json({
    checkoutUrl: komojuBody.session_url,
    sessionId: komojuBody.id,
    localOrderId: localOrder.id,
    pickupCode
  }, { headers: { "Cache-Control": "no-store" } });
}
