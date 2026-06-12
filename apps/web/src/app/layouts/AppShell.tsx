import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { appRoutes } from "@/lib/constants/routes";

const dockLinks = [
  { to: appRoutes.home, label: "首页" },
  { to: appRoutes.materialSearch, label: "查物料" },
  { to: appRoutes.palletSearch, label: "查卡板" },
  { to: appRoutes.operationLogs, label: "日志" },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === appRoutes.home;

  return (
    <div className="pf-shell">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-28 pt-5 sm:px-6">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Warehouse PWA</p>
            <h1 className="font-display text-2xl font-semibold text-ink">PalletFlow</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:justify-start">
            <NavLink
              to={appRoutes.inventoryExport}
              className="rounded-full bg-white/[0.82] px-4 py-2 text-xs font-semibold text-ink shadow-card sm:text-sm"
            >
              数据导出
            </NavLink>
            <NavLink
              to={appRoutes.masterDataImport}
              className="rounded-full bg-white/[0.82] px-4 py-2 text-xs font-semibold text-ink shadow-card sm:text-sm"
            >
              主数据导入
            </NavLink>
            {!isHome ? (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="rounded-full bg-white/[0.82] px-4 py-2 text-xs font-semibold text-ink shadow-card sm:text-sm"
              >
                返回
              </button>
            ) : (
              <span className="hidden pf-pill bg-pine/[0.12] text-pine sm:inline-flex">真实库存存于 Supabase</span>
            )}
          </div>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-white/60 bg-white/[0.88] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2">
          {dockLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `rounded-2xl px-3 py-3 text-center text-xs font-semibold ${
                  isActive ? "bg-ink text-white" : "bg-slate-100 text-slate-600"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
