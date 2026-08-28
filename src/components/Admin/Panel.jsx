import React, { useState, useEffect, Suspense } from "react";
import AdminPromoCodes from "./Promo";
import AdminCoachesProfilesPanel from "./Coaches";
import { styles } from "../shared/appShared";

const AdminMarketplacePanel = React.lazy(() => import("../AdminMarketplacePanel"));

export default function AdminPanel({ notify, adminUserId }) {
  const [adminTab, setAdminTab] = useState(() => {
    if (typeof localStorage === "undefined") return "promo";
    const saved = localStorage.getItem("raf_admin_tab");
    return saved || "promo";
  });
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem("raf_admin_tab", adminTab);
  }, [adminTab]);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 10px 0", padding: "0 16px" }}>
        <button type="button" onClick={() => setAdminTab("promo")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "promo" ? "rgba(124,58,237,.12)" : "#fff", color: adminTab === "promo" ? "#6d28d9" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🎟️ Promo</button>
        <button type="button" onClick={() => setAdminTab("marketplace")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "marketplace" ? "rgba(14,165,233,.12)" : "#fff", color: adminTab === "marketplace" ? "#0369a1" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🛒 Marketplace</button>
        <button type="button" onClick={() => setAdminTab("coaches")} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", background: adminTab === "coaches" ? "rgba(99,102,241,.12)" : "#fff", color: adminTab === "coaches" ? "#4338ca" : "#334155", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>👥 Coaches</button>
      </div>
      {adminTab === "promo" ? (
        <AdminPromoCodes notify={notify} />
      ) : adminTab === "marketplace" ? (
        <Suspense fallback={<div style={{ padding: 24, color: "#64748b" }}>Cargando marketplace…</div>}>
          <AdminMarketplacePanel notify={notify} styles={styles} />
        </Suspense>
      ) : (
        <AdminCoachesProfilesPanel notify={notify} adminUserId={adminUserId} />
      )}
    </div>
  );
}
