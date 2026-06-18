import { createCustomerOrder, createPickupCode, updateCustomerOrder } from "../../../../../../lib/customer-orders";
import { calculateCouponDiscount, getUsableMemberCoupon, resolveMemberForOrder } from "../../../../../../lib/loyalty";
import { getMaamaaCompatibleMenu, type MaamaaMenuSection, type MaamaaPricedOption } from "../../../../../../lib/maamaa-compatible-menu";
import { getActiveStorePaymentAccount } from "../../../../../../lib/store-payment-accounts";
import { isPickupWithinBusinessHours } from "../../../../../../lib/store-business-hours";
import { getTemporaryClosureForPickup } from "../../../../../../lib/store-temporary-closures";

export const dynamic = "force-dynamic";

function compareDateTime(dateA: string, timeA: string, dateB: string, timeB: string) {
  return `${dateA}T${timeA}`.localeCompare(`${dateB}T${timeB}`);
}

function normalizeMinimumPickupMinutes(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === "") return fallback;
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return fallback;
  return Math.max(0, Math.min(240, minutes));
}

function getTokyoMinimumPickup(leadMinutes: number) {
  const now = new Date();
  const minimum = new Date(now.getTime() + leadMinutes * 60 * 1000);
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

function getTokyoNow() {
  return getTokyoMinimumPickup(0);
}

function addMinutesToTime(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const nextHour = Math.floor(total / 60);
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

const maamaaSameDayReceptionStartTime = "11:30";
const maamaaSameDayPickupStartTime = "12:00";
const maamaaSameDayPickupCutoffTime = "23:00";

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

function selectedFlavorIds(body: Record<string, unknown>) {
  const raw = body.specialFlavors ?? body.flavors ?? body.specialFlavor ?? [];
  return Array.isArray(raw) ? raw.map(String).filter(Boolean) : String(raw || "").trim() ? [String(raw)] : [];
}

function validateBuildableItem(rawItem: Record<string, unknown>, menu: Awaited<ReturnType<typeof getMaamaaCompatibleMenu>>["baseMenu"]) {
  const medicinalSpice = findChoice(menu.medicinalSpiceOptions, String(rawItem.medicinalSpice || rawItem.medicinalSpiceOption || rawItem.spice || ""), menu.medicinalSpiceOptions.length > 0);
  const heat = findChoice(menu.heatLevels, String(rawItem.heat || rawItem.heatLevel || ""), menu.heatLevels.length > 0);
  const numb = findChoice(menu.numbLevels, String(rawItem.numb || rawItem.numbLevel || ""), menu.numbLevels.length > 0);
  const specialFlavorItems = selectedFlavorIds(rawItem).map((id) => findChoice(menu.specialFlavors, id, true));

  if ((menu.medicinalSpiceOptions.length && !medicinalSpice) || (menu.heatLevels.length && !heat) || (menu.numbLevels.length && !numb)) {
    return { error: "Invalid soup customization" };
  }
  if (specialFlavorItems.some((item) => !item)) {
    return { error: "Invalid special flavor" };
  }

  let selectionError = "";
  const selectedSections = menu.menuSections.map((section) => {
    const ids = selectedIdsForSection(rawItem, section);
    if (ids.length > section.limit) {
      selectionError = `${section.title}は${section.limit}個まで選択できます。数量を減らしてから、もう一度お試しください。`;
      return { section, items: [] };
    }
    const items = ids.map((id) => findChoice(section.items, id, true));
    if (items.some((item) => !item)) {
      selectionError = `Invalid selection in ${section.title}`;
      return { section, items: [] };
    }
    return { section, items: items as MaamaaPricedOption[] };
  });
  if (selectionError) return { error: selectionError };

  const optionItems = [medicinalSpice, heat, numb, ...specialFlavorItems].filter(Boolean) as MaamaaPricedOption[];
  const toppingItems = selectedSections.flatMap((section) => section.items);
  const amount = menu.baseSoup.price +
    optionItems.reduce((sum, item) => sum + item.price, 0) +
    toppingItems.reduce((sum, item) => sum + item.price, 0);
  if (amount <= 0) return { error: "Invalid amount" };

  const customizationLabels = [
    medicinalSpice?.name,
    heat ? `辛さ: ${heat.name}` : "",
    numb ? `痺れ: ${numb.name}` : "",
    ...((specialFlavorItems.filter(Boolean) as MaamaaPricedOption[]).map((item) => `味変: ${item.name}`))
  ].filter(Boolean);
  const sectionLabels = selectedSections
    .filter((section) => section.items.length)
    .map(({ section, items }) => `${section.title}: ${items.map((item) => item.name).join(", ")}`);
  const detailLabel = [...customizationLabels, ...sectionLabels].join("\n");

  return {
    amount,
    detailLabel,
    optionItems,
    toppingItems,
    selectedSections,
    medicinalSpice,
    heat,
    numb,
    specialFlavorItems: specialFlavorItems.filter(Boolean) as MaamaaPricedOption[],
    sectionLabels
  };
}

function buildMaamaaItemPayload(
  item: Exclude<ReturnType<typeof validateBuildableItem>, { error: string }>,
  index: number,
  baseSoup: Awaited<ReturnType<typeof getMaamaaCompatibleMenu>>["baseMenu"]["baseSoup"]
) {
  return {
    itemIndex: index + 1,
    baseSoup: {
      id: baseSoup.id,
      menuCatalogItemId: baseSoup.menuCatalogItemId,
      name: baseSoup.name,
      price: baseSoup.price
    },
    customization: {
      medicinalSpice: item.medicinalSpice ? { id: item.medicinalSpice.id, name: item.medicinalSpice.name, price: item.medicinalSpice.price } : null,
      heat: item.heat ? { id: item.heat.id, name: item.heat.name, price: item.heat.price } : null,
      numb: item.numb ? { id: item.numb.id, name: item.numb.name, price: item.numb.price } : null,
      specialFlavors: item.specialFlavorItems.map((flavor) => ({ id: flavor.id, name: flavor.name, price: flavor.price }))
    },
    sections: item.selectedSections.map(({ section, items }) => ({
      sectionId: section.id,
      sectionTitle: section.title,
      items: items.map((selectedItem) => ({ id: selectedItem.id, name: selectedItem.name, price: selectedItem.price }))
    })),
    amount: item.amount,
    detailLabel: item.detailLabel
  };
}

function buildMaamaaProductionLabels(item: Exclude<ReturnType<typeof validateBuildableItem>, { error: string }>) {
  return [
    item.medicinalSpice?.name ?? "",
    item.heat ? `辛さ: ${item.heat.name}` : "",
    item.numb ? `痺れ: ${item.numb.name}` : "",
    ...item.specialFlavorItems.map((flavor) => `味変: ${flavor.name}`),
    ...item.toppingItems.map((topping) => topping.name)
  ].filter(Boolean);
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
  if (menu.baseSoup.websiteEnabled === false || menu.baseSoup.isAvailable === false) {
    return Response.json({ error: "Menu item is temporarily unavailable" }, { status: 409 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || !/^\d{2}:\d{2}$/.test(pickup)) {
    return Response.json({ error: "Invalid pickup time" }, { status: 400 });
  }
  const minimumPickupMinutes = normalizeMinimumPickupMinutes(operation.minimumPickupMinutes, 15);
  const tokyoNow = getTokyoNow();
  const minimumPickup = getTokyoMinimumPickup(minimumPickupMinutes);
  const earliestPickupTime = addMinutesToTime(maamaaSameDayPickupStartTime, minimumPickupMinutes);
  if (pickupDate !== tokyoNow.date) {
    return Response.json({ error: "Maamaa web reservations are only available for same-day pickup" }, { status: 400 });
  }
  if (tokyoNow.time < maamaaSameDayReceptionStartTime || minimumPickup.date !== tokyoNow.date || minimumPickup.time > maamaaSameDayPickupCutoffTime) {
    return Response.json({ error: `Maamaa web reservations are available from ${earliestPickupTime} until ${maamaaSameDayPickupCutoffTime}` }, { status: 400 });
  }
  if (pickup < earliestPickupTime) {
    return Response.json({ error: `Maamaa web reservations are available from ${earliestPickupTime}` }, { status: 400 });
  }
  if (pickup > maamaaSameDayPickupCutoffTime) {
    return Response.json({ error: `Maamaa web reservations are available until ${maamaaSameDayPickupCutoffTime}` }, { status: 400 });
  }
  if (compareDateTime(pickupDate, pickup, minimumPickup.date, minimumPickup.time) < 0) {
    return Response.json({ error: `Pickup time must be at least ${minimumPickupMinutes} minutes from now` }, { status: 400 });
  }
  if (!isPickupWithinBusinessHours(operation.businessHours, pickupDate, pickup)) {
    return Response.json({ error: "Pickup time is outside store business hours" }, { status: 409 });
  }
  const temporaryClosure = await getTemporaryClosureForPickup(publicStore.osStoreId, pickupDate, pickup);
  if (temporaryClosure) {
    return Response.json({ error: temporaryClosure.publicMessage || temporaryClosure.reason || "Selected pickup time is temporarily unavailable" }, { status: 409 });
  }

  const requestedItems = Array.isArray(body.items) && body.items.length
    ? body.items.map((item) => item as Record<string, unknown>)
    : [body];
  if (!requestedItems.length || requestedItems.length > 12) {
    return Response.json({ error: "Invalid order items" }, { status: 400 });
  }
  const validatedItems = requestedItems.map((item) => validateBuildableItem(item, menu));
  const invalidItem = validatedItems.find((item) => "error" in item);
  if (invalidItem && "error" in invalidItem) {
    return Response.json({ error: invalidItem.error }, { status: 400 });
  }
  const buildableItems = validatedItems as Array<Exclude<ReturnType<typeof validateBuildableItem>, { error: string }>>;
  const subtotalAmount = buildableItems.reduce((sum, item) => sum + item.amount, 0);

  const pickupCode = createPickupCode("M");
  const hasMemberReference = Boolean(body.memberId || body.memberToken || body.memberEmail || body.identitySubject);
  const member = hasMemberReference ? await resolveMemberForOrder({
    memberId: body.memberId as string | undefined,
    memberToken: body.memberToken as string | undefined,
    phone: body.memberPhone as string | undefined,
    email: body.memberEmail as string | undefined,
    displayName: body.memberName as string | undefined,
    identityProvider: body.identityProvider as string | undefined,
    identitySubject: body.identitySubject as string | undefined,
    identityLabel: body.identityLabel as string | undefined,
    metadata: { source: "maamaa_web" }
  }) : null;
  const couponId = String(body.couponId || "");
  const coupon = couponId && member?.id ? await getUsableMemberCoupon(member.id, couponId, { brandId }) : null;
  if (couponId && !coupon) return Response.json({ error: "Selected coupon is not available" }, { status: 400 });
  const couponDiscountAmount = coupon ? Math.min(calculateCouponDiscount(coupon, subtotalAmount), Math.max(0, subtotalAmount - 1)) : 0;
  if (coupon && couponDiscountAmount <= 0) return Response.json({ error: "Selected coupon cannot be applied to this order" }, { status: 400 });
  const amount = Math.max(0, subtotalAmount - couponDiscountAmount);
  const itemSummaries = buildableItems.map((item, index) => ({
    name: `${menu.baseSoup.name}${buildableItems.length > 1 ? ` #${index + 1}` : ""}`,
    detailLabel: item.detailLabel || "カスタマイズなし",
    sectionLabel: item.sectionLabels.join("\n") || "トッピングなし"
  }));
  const detailLabel = itemSummaries.map((item, index) => `${index + 1}. ${item.name}\n${item.detailLabel}`).join("\n\n");

  const localOrder = await createCustomerOrder({
    brandId,
    storeId: publicStore.osStoreId,
    orderSource: "maamaa_web",
    paymentProvider: "komoju",
    paymentAccountId: paymentAccount.id || undefined,
    memberId: member?.id,
    pickupCode,
    pickupDate,
    pickupTime: pickup,
    amount,
    customerSummary: {
      ...completionSummary,
      brand: "maamaa",
      store: publicStore.label,
      paymentAccountName: paymentAccount.accountName,
      memberId: member?.id ?? "",
      memberNumber: member?.memberNumber ?? "",
      subtotalAmount,
      couponId: coupon?.id ?? "",
      couponCode: coupon?.couponCode ?? "",
      couponName: coupon?.name ?? "",
      couponDiscountAmount,
      customer: {
        name: completionSummary.name ?? body.name ?? "",
        phone: completionSummary.phone ?? body.phone ?? ""
      },
      maamaa: {
        schema: "maamaa_buildable_v1",
        baseSoup: {
          id: menu.baseSoup.id,
          menuCatalogItemId: menu.baseSoup.menuCatalogItemId,
          name: menu.baseSoup.name,
          price: menu.baseSoup.price
        },
        items: buildableItems.map((item, index) => buildMaamaaItemPayload(item, index, menu.baseSoup))
      }
    },
    drink: buildableItems.length === 1 ? menu.baseSoup.name : itemSummaries.map((item) => item.name).join("\n"),
    size: detailLabel || "カスタマイズなし",
    temperature: "",
    sweetness: "",
    ice: "",
    option: "",
    toppings: itemSummaries.map((item, index) => `${index + 1}. ${item.sectionLabel}`).join("\n\n") || "トッピングなし",
    items: buildableItems.map((item) => ({
      menuCatalogItemId: menu.baseSoup.menuCatalogItemId,
      itemName: menu.baseSoup.name,
      sizeKey: "maamaa_buildable",
      sizeLabel: item.detailLabel || "カスタマイズなし",
      temperature: "",
      sweetness: "",
      ice: "",
      optionKey: item.specialFlavorItems.map((flavor) => flavor.id).join(","),
      optionLabel: item.specialFlavorItems.map((flavor) => `味変: ${flavor.name}`).join(", "),
      toppingKeys: [
        item.medicinalSpice?.id ?? "",
        item.heat?.id ?? "",
        item.numb?.id ?? "",
        ...item.specialFlavorItems.map((flavor) => flavor.id),
        ...item.toppingItems.map((topping) => topping.id)
      ].filter(Boolean),
      toppingLabels: buildMaamaaProductionLabels(item),
      amount: item.amount
    }))
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
  if (couponDiscountAmount) redirectUrl.searchParams.set("couponDiscount", String(couponDiscountAmount));

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
