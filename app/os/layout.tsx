import type { ReactNode } from "react";
import "./os-interface.css";

export default function OsLayout({ children }: { children: ReactNode }) {
  return <div className="os-interface">{children}</div>;
}
