import { readBrandSiteContent } from "../../../../lib/brand-site-content";

function normalizeBrandKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const brandKey = normalizeBrandKey(url.searchParams.get("brand"));
  const data = await readBrandSiteContent();
  const brand = data.brands.find((entry) => {
    const name = normalizeBrandKey(entry.name);
    if (!brandKey) return false;
    if (brandKey === String(entry.id).toLowerCase()) return true;
    if (name === brandKey) return true;
    if (brandKey === "nanacha" && name.includes("nanacha")) return true;
    if ((brandKey === "maamaa" || brandKey === "maaama") && (name.includes("maamaa") || String(entry.name).includes("まぁ麻"))) return true;
    return false;
  });

  if (!brand) return Response.json({ error: "Brand not found." }, { status: 404 });

  return Response.json({
    brand,
    sections: data.sections.filter((section) => section.brandId === brand.id && section.isActive)
  });
}
