import { StoreTerminalLoginApproval } from "./StoreTerminalLoginApproval";

export default async function StoreTerminalLoginPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  return <StoreTerminalLoginApproval token={String(params.token ?? "")} />;
}
