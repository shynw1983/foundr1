import { StaffLoginPage } from "../../../components/auth/StaffLoginPage";

// Store WebViews must always receive the current QR-first login shell instead of
// reviving a stale, previously cached password-login page.
export const dynamic = "force-dynamic";

export default function StoreLoginPage() {
  return <StaffLoginPage surface="store" />;
}
