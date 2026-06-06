import { issueMonthlyBirthdayCoupons } from "../../../../../lib/loyalty";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function runBirthdayCouponCron(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await issueMonthlyBirthdayCoupons();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  return runBirthdayCouponCron(request);
}

export async function POST(request: Request) {
  return runBirthdayCouponCron(request);
}
