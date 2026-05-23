"use client";

import { useEffect, useState } from "react";

type CurrentEmployee = {
  name: string;
  loginId: string;
  role: string;
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  buyer: "Buyer"
};

export function UserBadge() {
  const [employee, setEmployee] = useState<CurrentEmployee | null>(null);

  useEffect(() => {
    async function loadCurrentUser() {
      const response = await fetch("/api/auth/me");
      if (!response.ok) return;
      const body = await response.json() as { employee?: CurrentEmployee };
      if (body.employee) setEmployee(body.employee);
    }

    void loadCurrentUser();
  }, []);

  if (!employee) {
    return <span className="user-badge user-badge-muted">ログイン確認中</span>;
  }

  return (
    <span className="user-badge" title={`ログインID: ${employee.loginId}`}>
      <span className="user-badge-name">{employee.name}</span>
      <span className="user-badge-role">{roleLabels[employee.role] ?? employee.role}</span>
    </span>
  );
}
