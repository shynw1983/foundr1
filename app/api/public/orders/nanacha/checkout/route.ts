import { randomUUID } from "crypto";
import { createCustomerOrder, createPickupCode, updateCustomerOrder } from "../../../../../../lib/customer-orders";
import { sql } from "../../../../../../lib/db";
import { getNanachaCompatibleMenu, type NanachaPricedOption } from "../../../../../../lib/nanacha-compatible-menu";

export const dynamic = "force-dynamic";

const squareVersion = "2026-01-22";

function cleanEnv(value = "") {
  return String(value).trim().replace(/^["']|["']$/g, "");
}

function cleanAccessToken(value = "") {
  return cleanEnv(value).replace(/^Bearer\s+/i, "");
}

function findById<T extends { id: string }>(items: T[], id: string) {
  return items.find((item) => item.id === id);
}

function allowedSet(drink: Record<string, unknown>, field: string) {
  const values = Array.isArray(drink[field]) ? (drink[field] as unknown[]).map(String).filter(Boolean) : [];
  return values.length ? new Set(values) : null;
}

function filterAllowedIds(items: NanachaPricedOption[], drink: Record<string, unknown>, field: string) {
  const allowed = allowedSet(drink, field);
  if (!allowed) return items;
  const filtered = items.filter((item) => allowed.has(item.id));
  return filtered.length ? filtered : items;
}

function filterAllowedValues(items: string[], drink: Record<string, unknown>, field: string) {
  const allowed = allowedSet(drink, field);
  if (!allowed) return items;
  const filtered = items.filter((item) => allowed.has(item));
  return filtered.length ? filtered : items;
}

function filterAllowedOptions(items: NanachaPricedOption[], drink: Record<string, unknown>) {
  const allowed = allowedSet(drink, "allowedOptions");
  return items.filter((item) => item.id === "none" || !allowed || allowed.has(item.id));
}

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

function formatSweetnessLabel(value: string) {
  return value ? `甘さ: ${value}` : "";
}

function formatIceLabel(value: string) {
  return value ? `氷: ${value}` : "";
}

async function getStoreOperation(storeId: string) {
  const rows = await sql`
    select reservations_enabled as "reservationsEnabled", status_note as "statusNote"
    from store_operations
    where store_id = ${storeId}
    limit 1
  `;
  return (rows[0] as { reservationsEnabled: boolean; statusNote: string } | undefined) ?? { reservationsEnabled: true, statusNote: "" };
}

export async function POST(request: Request) {
  const accessToken = cleanAccessToken(process.env.SQUARE_ACCESS_TOKEN);
  const locationId = cleanEnv(process.env.SQUARE_LOCATION_ID);
  const environment = cleanEnv(process.env.SQUARE_ENVIRONMENT || "production").toLowerCase();

  if (!accessToken || !locationId) {
    return Response.json({ code: "SQUARE_NOT_CONFIGURED", error: "Square is not configured." }, { status: 500 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request body" }, { status: 400 });

  const storeId = String(body.store || "");
  const pickupDate = String(body.pickupDate || "");
  const pickup = String(body.pickup || "");
  const completionUrl = String(body.completionUrl || "");
  const completionPath = String(body.completionPath || "/order-complete");
  const completionSummary = (body.completionSummary || {}) as Record<string, unknown>;
  const requestedItems =
    Array.isArray(body.items) && body.items.length
      ? body.items.map((item) => item as Record<string, unknown>)
      : [
          {
            drink: body.drink,
            temperature: body.temperature,
            sweetness: body.sweetness,
            ice: body.ice,
            size: body.size,
            option: body.option,
            toppings: body.toppings
          }
        ];

  const { brandId, baseMenu: menu } = await getNanachaCompatibleMenu(request.url);
  const publicStore = menu.stores.find((store) => store.id === storeId || store.label === storeId) ?? (menu.stores.length === 1 ? menu.stores[0] : null);
  if (!publicStore) return Response.json({ error: "Unknown store" }, { status: 400 });

  const operation = await getStoreOperation(publicStore.osStoreId);
  if (!operation.reservationsEnabled) {
    return Response.json({ error: "Reservations are temporarily paused for this store" }, { status: 409 });
  }

  if (!requestedItems.length || requestedItems.length > 12) {
    return Response.json({ error: "Invalid order items" }, { status: 400 });
  }

  const validatedItems = [];
  for (const rawItem of requestedItems) {
    const item = {
      drink: String(rawItem.drink || ""),
      temperature: String(rawItem.temperature || ""),
      sweetness: String(rawItem.sweetness || ""),
      ice: String(rawItem.ice || ""),
      size: String(rawItem.size || ""),
      option: String(rawItem.option || ""),
      toppings: Array.isArray(rawItem.toppings) ? rawItem.toppings.map(String) : []
    };
    const menuDrink = menu.drinks.find((drinkItem) => drinkItem.name === item.drink && drinkItem.websiteEnabled !== false);
    if (!menuDrink) return Response.json({ error: "Unknown drink" }, { status: 400 });

    const availableSizes = filterAllowedIds(menu.sizes, menuDrink, "allowedSizes");
    const availableSweetness = filterAllowedValues(menu.sweetness, menuDrink, "allowedSweetness");
    const availableIce = item.temperature === "HOT" ? [menu.hotIce] : filterAllowedValues(menu.ice, menuDrink, "allowedIce");
    const availableOptions = filterAllowedOptions(menu.options, menuDrink);
    const availableToppings = filterAllowedIds(menu.toppings, menuDrink, "allowedToppings");
    const size = findById(availableSizes, item.size);
    const option = findById(availableOptions, item.option);
    const toppings = item.toppings.map((id) => findById(availableToppings, id));

    if (!size || !availableSweetness.includes(item.sweetness) || !option) return Response.json({ error: "Invalid customization" }, { status: 400 });
    if (!menuDrink.temperatures.includes(item.temperature)) return Response.json({ error: "Invalid temperature" }, { status: 400 });
    if (!availableIce.includes(item.ice)) return Response.json({ error: "Invalid ice amount" }, { status: 400 });
    if (toppings.some((topping) => !topping)) return Response.json({ error: "Invalid topping" }, { status: 400 });
    if (menu.tapiocaFreeCategories.includes(menuDrink.category) && item.toppings.includes("no-tapioca")) return Response.json({ error: "Invalid topping for tapioca-free category" }, { status: 400 });
    if (!menu.whippedCategories.includes(menuDrink.category) && item.toppings.includes("no-whip")) return Response.json({ error: "Invalid topping for non-whip category" }, { status: 400 });

    const amount = menuDrink.price + size.price + option.price + toppings.reduce((sum, topping) => sum + (topping?.price ?? 0), 0);
    if (amount <= 0) return Response.json({ error: "Invalid amount" }, { status: 400 });

    validatedItems.push({
      drink: menuDrink,
      size,
      temperature: item.temperature,
      sweetness: item.sweetness,
      ice: item.ice,
      option,
      toppings: toppings as NanachaPricedOption[],
      amount
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || !/^\d{2}:\d{2}$/.test(pickup)) {
    return Response.json({ error: "Invalid pickup time" }, { status: 400 });
  }
  const minimumPickup = getTokyoMinimumPickup();
  if (compareDateTime(pickupDate, pickup, minimumPickup.date, minimumPickup.time) < 0) {
    return Response.json({ error: "Pickup time must be at least 5 minutes from now" }, { status: 400 });
  }

  const amount = validatedItems.reduce((sum, item) => sum + item.amount, 0);
  const itemSummaries = validatedItems.map((item, index) => {
    const toppingLabel = item.toppings.length ? item.toppings.map((topping) => topping.label).join(", ") : "トッピングなし";
    const optionLabel = item.option.id === "none" ? "オプションなし" : item.option.label;
    const sweetnessLabel = formatSweetnessLabel(item.sweetness);
    const iceLabel = formatIceLabel(item.ice);
    return {
      name: item.drink.name,
      orderName: `${item.drink.name} / ${item.size.label} / ${item.temperature} / ${sweetnessLabel} / ${iceLabel}`,
      description: `${index + 1}. ${item.drink.name} / ${item.size.label} / ${item.temperature} / ${sweetnessLabel} / ${iceLabel} / ${optionLabel} / ${toppingLabel}`,
      sizeLabel: item.size.label,
      sweetnessLabel,
      iceLabel,
      optionLabel,
      toppingLabel
    };
  });
  const primaryItem = validatedItems[0];
  const primarySummary = itemSummaries[0];
  const drinkLabel = itemSummaries.length === 1 ? primarySummary.name : itemSummaries.map((item, index) => `${index + 1}. ${item.name}`).join("\n");
  const itemDetailLabel = itemSummaries.map((item) => item.description).join("\n");
  const sizeLabel = itemSummaries.length === 1 ? primarySummary.sizeLabel : itemDetailLabel;
  const temperatureLabel = itemSummaries.length === 1 ? primaryItem.temperature : "複数商品";
  const sweetnessLabel = itemSummaries.length === 1 ? primarySummary.sweetnessLabel : "商品ごと";
  const iceLabel = itemSummaries.length === 1 ? primarySummary.iceLabel : "商品ごと";
  const optionLabel = itemSummaries.length === 1 ? primarySummary.optionLabel : "商品ごと";
  const toppingLabel = itemSummaries.length === 1 ? primarySummary.toppingLabel : "商品ごと";
  const pickupCode = createPickupCode("N");

  const localOrder = await createCustomerOrder({
    brandId,
    storeId: publicStore.osStoreId,
    pickupCode,
    pickupDate,
    pickupTime: pickup,
    amount,
    customerSummary: completionSummary,
    drink: drinkLabel,
    size: sizeLabel,
    temperature: temperatureLabel,
    sweetness: sweetnessLabel,
    ice: iceLabel,
    option: optionLabel,
    toppings: toppingLabel,
    items: validatedItems.map((item) => ({
      menuCatalogItemId: item.drink.menuCatalogItemId,
      itemName: item.drink.name,
      sizeKey: item.size.id,
      sizeLabel: item.size.label,
      temperature: item.temperature,
      sweetness: item.sweetness,
      ice: item.ice,
      optionKey: item.option.id,
      optionLabel: item.option.label,
      toppingKeys: item.toppings.map((topping) => topping.id),
      toppingLabels: item.toppings.map((topping) => topping.label),
      amount: item.amount
    }))
  });

  if (!localOrder) return Response.json({ error: "Order could not be created" }, { status: 500 });

  const squareHost = environment === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
  const orderName = itemSummaries.length === 1 ? primarySummary.orderName : `${itemSummaries.length} items`;
  const orderDescription = [
    `pickup number: ${pickupCode}`,
    `nanacha pickup order: ${orderName}`,
    ...itemSummaries.map((item) => item.description),
    `pickup: ${pickupDate} ${pickup}`
  ].join(" / ");
  const redirectBase = completionUrl || new URL(completionPath, request.url).toString();
  const redirectUrl = new URL(redirectBase);
  redirectUrl.searchParams.set("orderId", localOrder.id);
  redirectUrl.searchParams.set("pickupCode", pickupCode);
  redirectUrl.searchParams.set("pickupDate", pickupDate);
  redirectUrl.searchParams.set("pickupTime", pickup);
  redirectUrl.searchParams.set("drink", String(completionSummary.drink || drinkLabel));
  redirectUrl.searchParams.set("size", String(completionSummary.size || sizeLabel));
  redirectUrl.searchParams.set("temperature", String(completionSummary.temperature || temperatureLabel));
  redirectUrl.searchParams.set("sweetness", String(completionSummary.sweetness || sweetnessLabel));
  redirectUrl.searchParams.set("ice", String(completionSummary.ice || iceLabel));
  redirectUrl.searchParams.set("option", String(completionSummary.option || optionLabel));
  redirectUrl.searchParams.set("toppings", Array.isArray(completionSummary.toppings) ? completionSummary.toppings.join(", ") : toppingLabel);
  redirectUrl.searchParams.set("total", String(completionSummary.total || amount));

  const squareResponse = await fetch(`${squareHost}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": squareVersion
    },
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      description: orderDescription,
      quick_pay: {
        name: `${itemSummaries.length === 1 ? primarySummary.name : `nanacha pickup ${itemSummaries.length} items`} (${pickupDate} ${pickup} pickup)`,
        price_money: { amount, currency: "JPY" },
        location_id: locationId
      },
      checkout_options: {
        redirect_url: redirectUrl.toString(),
        ask_for_shipping_address: false
      }
    })
  });
  const squareBody = await squareResponse.json();
  if (!squareResponse.ok) {
    await updateCustomerOrder(localOrder.id, { status: "checkout_failed", paymentStatus: "failed" });
    return Response.json({ code: "SQUARE_CHECKOUT_FAILED", error: "Square checkout could not be created", details: squareBody.errors || squareBody }, { status: squareResponse.status });
  }

  await updateCustomerOrder(localOrder.id, { squareOrderId: squareBody.payment_link?.order_id || "" });
  return Response.json({
    checkoutUrl: squareBody.payment_link?.url,
    orderId: squareBody.payment_link?.order_id,
    localOrderId: localOrder.id,
    pickupCode
  }, { headers: { "Cache-Control": "no-store" } });
}
