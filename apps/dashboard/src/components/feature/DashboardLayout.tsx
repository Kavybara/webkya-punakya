import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Role } from "../../mocks/data";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { MobileMenu } from "./MobileMenu";
import { PageTransition } from "./PageTransition";
import { clearSession, readSession } from "../../lib/session";

function hasAllowedSession(role: Role) {
  try {
    const session = readSession();
    return Boolean(session?.token && session?.role === role);
  } catch {
    return false;
  }
}

export function DashboardLayout({
  role,
  title,
  children,
}: {
  role: Role;
  title: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [allowed, setAllowed] = useState(() => hasAllowedSession(role));
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const session = readSession();
      if (!session?.token || !session?.role) {
        navigate("/login", { replace: true });
        return;
      }
      if (session.role !== role) {
        navigate(session.role === "owner" ? "/dashboard" : "/reseller", { replace: true });
        return;
      }
      setAllowed(true);
    } catch {
      clearSession();
      navigate("/login", { replace: true });
    }
  }, [navigate, role]);

  if (!allowed) return null;

  return (
    <div className="min-h-screen bg-[#f2ece2] text-slate-900">
      <Sidebar role={role} />
      <MobileMenu open={menuOpen} role={role} onClose={() => setMenuOpen(false)} />
      <div className="min-w-0 md:pl-[238px]">
        <Navbar title={title} role={role} onMenuClick={() => setMenuOpen(true)} />
        <main className="w-full min-w-0 px-3 pb-20 pt-3 sm:px-4 md:px-6 md:pb-8 md:pt-4">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
