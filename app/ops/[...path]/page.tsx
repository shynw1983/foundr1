import { redirect } from "next/navigation";

type LegacyOpsRedirectProps = {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyOpsRedirect({ params, searchParams }: LegacyOpsRedirectProps) {
  const [{ path = [] }, query] = await Promise.all([params, searchParams]);
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else if (typeof value === "string") {
      search.set(key, value);
    }
  }

  redirect(`/os/${path.join("/")}${search.size ? `?${search.toString()}` : ""}`);
}
