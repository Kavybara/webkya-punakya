import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PageTransition } from "./PageTransition";
import { clearSession, readSession } from "../../lib/session";
import { ResellerShell } from "../reseller-v2/ResellerShell";

function hasAllowedSession() {
  try {
    const session = readSession();
    return Boolean(session?.role === "reseller");
  } catch {
    return false;
  }
}

export function DashboardLayout({
  title,
  children,
}: {
  role: "reseller";
  title: string;
  children: ReactNode;
}) {
  const [allowed, setAllowed] = useState(hasAllowedSession);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const session = readSession();
      if (!session?.role) {
        navigate("/login", { replace: true });
        return;
      }
      if (session.role !== "reseller") {
        navigate(session.role === "owner" ? "/owner-v2" : "/reseller-v2/ringkasan", { replace: true });
        return;
      }
      setAllowed(true);
    } catch {
      clearSession();
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  if (!allowed) return null;

  return (
    <ResellerShell title={title} description="Kelola kebutuhan reseller melalui panel Kavya.">
      <div className="reseller-v2-legacy-content">
        <PageTransition>{children}</PageTransition>
      </div>
    </ResellerShell>
  );
}
