import { TableOrderClient } from "./TableOrderClient";

export const dynamic = "force-dynamic";

type TableOrderPageProps = {
  params: Promise<{ token: string }>;
};

export default async function TableOrderPage({ params }: TableOrderPageProps) {
  const { token } = await params;
  return <TableOrderClient token={token} />;
}
