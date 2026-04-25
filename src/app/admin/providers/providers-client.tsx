"use client";

/**
 * /admin/providers — provider CRUD (X-DREAMER themed)
 *
 * Layout: header + glass legend + glass table card + dark modal forms.
 *
 * All CRUD logic preserved: list, toggle active, add, edit. Same API
 * routes (/api/admin/providers, PATCH /api/admin/providers/{id}).
 *
 * Wrapped by server component `page.tsx` that sets `dynamic = "force-dynamic"`
 * so admin pages don't get baked into Next.js prerender cache (5min stale).
 */

import { useState, useEffect } from "react";

const HUE = 70;

interface Provider {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  baseUrl: string | null;
  authType: string;
  isActive: boolean;
  supportsImage: boolean;
  supportsVideo: boolean;
  supportsEdit: boolean;
  sortOrder: number;
  accountCount?: number;
  modelCount?: number;
}

const defaultNewProvider = {
  name: "",
  slug: "",
  baseUrl: "",
  authType: "bearer",
  supportsImage: false,
  supportsVideo: false,
  supportsEdit: false,
  sortOrder: "0",
};

// Shared input style
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  background: "rgba(2,6,23,0.55)", color: "#f1f5f9",
  border: "1px solid rgba(255,255,255,0.1)",
  fontSize: 13, fontFamily: "inherit", outline: "none",
};

const monoInputStyle: React.CSSProperties = {
  ...inputStyle, fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em",
};

// ─── Provider form (shared by add + edit modals) ────────────────────
function ProviderForm({
  data, setData, autoSlug,
}: {
  data: { name: string; slug: string; baseUrl: string | null; authType: string; supportsImage: boolean; supportsVideo: boolean; supportsEdit: boolean; sortOrder: number | string };
  setData: (next: typeof data) => void;
  autoSlug: (n: string) => string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>ชื่อ Provider</div>
        <input value={data.name}
          onChange={(e) => {
            const name = e.target.value;
            setData({
              ...data, name,
              slug: data.slug === autoSlug(data.name) || data.slug === ""
                ? autoSlug(name) : data.slug,
            });
          }}
          placeholder="เช่น BytePlus, Replicate" style={inputStyle} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>Slug</div>
        <input value={data.slug}
          onChange={(e) => setData({ ...data, slug: e.target.value })}
          placeholder="byteplus" style={monoInputStyle} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>Base URL</div>
        <input value={data.baseUrl || ""}
          onChange={(e) => setData({ ...data, baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1" style={monoInputStyle} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>Auth Type</div>
          <select value={data.authType}
            onChange={(e) => setData({ ...data, authType: e.target.value })}
            style={inputStyle}>
            <option value="bearer" style={{ background: "#0f172a" }}>Bearer Token</option>
            <option value="api_key" style={{ background: "#0f172a" }}>API Key Header</option>
            <option value="hmac" style={{ background: "#0f172a" }}>HMAC Signature</option>
            <option value="custom" style={{ background: "#0f172a" }}>Custom</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.04em" }}>Sort</div>
          <input type="number" value={data.sortOrder}
            onChange={(e) => setData({ ...data, sortOrder: e.target.value })}
            style={monoInputStyle} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, letterSpacing: "0.04em" }}>ความสามารถ</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {([
            { k: "supportsImage" as const, l: "Image", icon: "▧", hue: 200 },
            { k: "supportsVideo" as const, l: "Video", icon: "▶", hue: 280 },
            { k: "supportsEdit"  as const, l: "Edit",  icon: "✦", hue: 160 },
          ]).map(cap => {
            const on = !!data[cap.k];
            const h = (cap.hue + HUE) % 360;
            return (
              <label key={cap.k} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 12,
                background: on ? `hsla(${h},60%,40%,0.25)` : "rgba(255,255,255,0.04)",
                color: on ? "#fff" : "#94a3b8",
                border: on ? `1px solid hsla(${h},70%,60%,0.45)` : "1px solid rgba(255,255,255,0.08)",
                transition: "all 200ms",
              }}>
                <input type="checkbox" checked={on}
                  onChange={(e) => setData({ ...data, [cap.k]: e.target.checked })}
                  style={{ display: "none" }} />
                <span style={{ color: on ? `hsl(${h},80%,75%)` : "#64748b" }}>{cap.icon}</span>
                {cap.l}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Modal shell ────────────────────────────────────────────────────
function Modal({ title, children, onClose, onSave }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(2,6,23,0.85)", backdropFilter: "blur(8px)",
      display: "grid", placeItems: "center", padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto",
        padding: 32, borderRadius: 24,
        background: "rgba(15,23,42,0.95)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 50px 100px -20px rgba(0,0,0,0.7)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          {/* Modal title — matches DashboardPage h2 spec (lighter weight + tracking) */}
          <h3 style={{ fontSize: 22, fontWeight: 300, color: "#fff", margin: 0, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{title}</h3>
          <button onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 10,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
              color: "#94a3b8", cursor: "pointer", fontSize: 16,
              flexShrink: 0,
              transition: "all 250ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#94a3b8"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}>×</button>
        </div>
        {children}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 28 }}>
          {/* Cancel — ghost button (matches Nav cta-ghost spec) */}
          <button onClick={onClose}
            style={{
              padding: "11px 20px", borderRadius: 12,
              background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.15)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              transition: "all 250ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}>
            ยกเลิก
          </button>
          {/* Save — primary CTA spec (3-stop gradient + lift on hover) */}
          <button onClick={onSave}
            style={{
              padding: "12px 22px", borderRadius: 12,
              background: "linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%)",
              color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer",
              boxShadow: `0 12px 30px -10px hsla(${270 + HUE},80%,50%,0.6)`,
              transition: "all 250ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.filter = "brightness(1.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.filter = ""; }}>
            บันทึก →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────
export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [newProvider, setNewProvider] = useState({ ...defaultNewProvider });

  const fetchProviders = () => {
    setLoading(true);
    fetch("/api/admin/providers").then(r => r.json()).then(data => {
      setProviders(data.providers || []); setLoading(false);
    }).catch(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchProviders(); }, []);

  const toggleActive = async (id: number, isActive: boolean) => {
    await fetch(`/api/admin/providers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchProviders();
  };

  const handleAdd = async () => {
    await fetch("/api/admin/providers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newProvider, sortOrder: parseInt(String(newProvider.sortOrder)) || 0 }),
    });
    setShowAddModal(false);
    setNewProvider({ ...defaultNewProvider });
    fetchProviders();
  };

  const handleEdit = async () => {
    if (!editingProvider) return;
    await fetch(`/api/admin/providers/${editingProvider.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editingProvider.name, slug: editingProvider.slug,
        baseUrl: editingProvider.baseUrl, authType: editingProvider.authType,
        supportsImage: editingProvider.supportsImage, supportsVideo: editingProvider.supportsVideo, supportsEdit: editingProvider.supportsEdit,
        sortOrder: editingProvider.sortOrder,
      }),
    });
    setEditingProvider(null);
    fetchProviders();
  };

  const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  const capChip = (label: string, on: boolean, hue: number) => {
    const h = (hue + HUE) % 360;
    if (!on) return null;
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "3px 8px", borderRadius: 999, fontSize: 10,
        background: `hsla(${h},60%,40%,0.2)`,
        color: `hsl(${h},80%,75%)`,
        border: `1px solid hsla(${h},60%,55%,0.3)`,
        textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
      }}>{label}</span>
    );
  };

  return (
    <div style={{ color: "#f1f5f9" }}>
      {/* Header — matches X-DREAMER section/page heading spec */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.16em", color: "#a5f3fc", textTransform: "uppercase", marginBottom: 12 }}>· admin · providers</div>
          {/* H1 spec: clamp(48px, 6vw, 80px), weight 300, ls -0.02em, lh 1.05 */}
          <h1 style={{ fontSize: "clamp(40px, 5vw, 64px)", fontWeight: 300, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.05, margin: 0 }}>
            จัดการ{" "}
            <span className="xdr-italic-th" style={{ fontStyle: "italic", fontWeight: 200, color: "#c4b5fd" }}>Providers</span>
            {" "}
            <span style={{ display: "inline-block", padding: "4px 14px", borderRadius: 999, background: "rgba(165,243,252,0.08)", border: "1px solid rgba(165,243,252,0.25)", fontSize: 14, fontWeight: 500, color: "#a5f3fc", letterSpacing: "0.04em", verticalAlign: "middle", marginLeft: 8 }}>
              {providers.length} ตัว
            </span>
          </h1>
          <p style={{ marginTop: 14, fontSize: 16, color: "rgba(203,213,225,0.7)", fontWeight: 300, lineHeight: 1.55 }}>
            จัดการ AI providers ทั้งหมด · เพิ่ม / แก้ไข / สลับเปิดปิด
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Refresh — secondary ghost button (matches nav cta-ghost spec) */}
          <button onClick={fetchProviders} title="Refresh"
            style={{
              padding: "11px 14px", borderRadius: 12,
              background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.15)",
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              transition: "all 250ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}>↻</button>
          {/* Primary CTA — matches Nav cta-primary 3-stop gradient + Studio button spec */}
          <button onClick={() => setShowAddModal(true)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 12,
              background: "linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #8b5cf6 100%)",
              color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer",
              boxShadow: `0 12px 30px -10px hsla(${270 + HUE},80%,50%,0.6)`,
              transition: "all 250ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.filter = "brightness(1.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.filter = ""; }}>
            + เพิ่ม Provider <span style={{ fontSize: 16 }}>→</span>
          </button>
        </div>
      </div>

      {/* Auth type legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 18, fontSize: 11, color: "#64748b" }}>
        {[
          { k: "bearer", l: "Bearer Token" },
          { k: "api_key", l: "API Key Header" },
          { k: "hmac", l: "HMAC Signature" },
        ].map(t => (
          <span key={t.k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: `hsl(${220 + HUE},70%,75%)` }}>◇</span>
            <span style={{ fontFamily: "ui-monospace,monospace", color: "#94a3b8" }}>{t.k}</span>
            <span>=</span> {t.l}
          </span>
        ))}
      </div>

      {/* Table */}
      <div style={{
        borderRadius: 18, overflow: "hidden",
        background: "rgba(15,23,42,0.5)", border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(18px)",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(2,6,23,0.4)" }}>
                <th style={th()}>สถานะ</th>
                <th style={th()}>Provider</th>
                <th style={th()}>Slug</th>
                <th style={th("center")}>Auth</th>
                <th style={th("center")}>ความสามารถ</th>
                <th style={th("center")}>ลำดับ</th>
                <th style={th("right")}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={td("center", "#64748b")}>⟳ กำลังโหลด...</td></tr>
              ) : providers.length === 0 ? (
                <tr><td colSpan={7} style={td("center", "#64748b")}>
                  ยังไม่มี provider — กด <span style={{ color: "#a5f3fc" }}>+ เพิ่ม Provider</span> เพื่อเริ่ม
                </td></tr>
              ) : providers.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <td style={td()}>
                    <span style={{
                      display: "inline-block", width: 8, height: 8, borderRadius: 999,
                      background: p.isActive ? "#34d399" : "#475569",
                      boxShadow: p.isActive ? "0 0 8px #34d399" : "none",
                    }} />
                  </td>
                  <td style={{ ...td(), fontWeight: 500, color: "#f1f5f9" }}>{p.name}</td>
                  <td style={td()}>
                    <span style={{
                      padding: "3px 8px", borderRadius: 6, fontSize: 11,
                      background: "rgba(2,6,23,0.5)", border: "1px solid rgba(255,255,255,0.06)",
                      fontFamily: "ui-monospace,monospace", color: "#a5f3fc",
                    }}>{p.slug}</span>
                  </td>
                  <td style={{ ...td("center"), fontFamily: "ui-monospace,monospace", color: "#94a3b8", fontSize: 11 }}>{p.authType}</td>
                  <td style={td("center")}>
                    <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
                      {capChip("Image", p.supportsImage, 200)}
                      {capChip("Video", p.supportsVideo, 280)}
                      {capChip("Edit", p.supportsEdit, 160)}
                      {!p.supportsImage && !p.supportsVideo && !p.supportsEdit && <span style={{ color: "#475569" }}>—</span>}
                    </div>
                  </td>
                  <td style={{ ...td("center"), fontFamily: "ui-monospace,monospace", color: "#94a3b8" }}>{p.sortOrder}</td>
                  <td style={td("right")}>
                    {/* Action toolbar — matches Studio frame toolbar spec (rgba+blur+border) */}
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <button onClick={() => toggleActive(p.id, p.isActive)} title={p.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                        style={{
                          width: 32, height: 32, borderRadius: 10,
                          background: p.isActive
                            ? "linear-gradient(135deg, hsla(160,70%,40%,0.25), hsla(180,70%,40%,0.25))"
                            : "rgba(0,0,0,0.4)",
                          backdropFilter: "blur(8px)",
                          border: `1px solid ${p.isActive ? "hsla(160,70%,55%,0.4)" : "rgba(255,255,255,0.12)"}`,
                          color: p.isActive ? "#34d399" : "#94a3b8",
                          cursor: "pointer", fontSize: 13,
                          transition: "all 250ms cubic-bezier(0.4,0,0.2,1)",
                          boxShadow: p.isActive ? "0 0 12px hsla(160,70%,50%,0.3)" : "none",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
                        onMouseLeave={(e) => e.currentTarget.style.transform = ""}>
                        {p.isActive ? "●" : "○"}
                      </button>
                      <button onClick={() => setEditingProvider({ ...p })} title="แก้ไข"
                        style={{
                          width: 32, height: 32, borderRadius: 10,
                          background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          color: "#a5f3fc", cursor: "pointer", fontSize: 13,
                          transition: "all 250ms cubic-bezier(0.4,0,0.2,1)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.background = `hsla(${220 + HUE},60%,40%,0.25)`; e.currentTarget.style.borderColor = `hsla(${220 + HUE},70%,55%,0.4)`; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.background = "rgba(0,0,0,0.4)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}>
                        ✎
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add modal */}
      {showAddModal && (
        <Modal title="เพิ่ม Provider" onClose={() => setShowAddModal(false)} onSave={handleAdd}>
          <ProviderForm
            data={{ ...newProvider, baseUrl: newProvider.baseUrl }}
            setData={(d) => setNewProvider({
              name: d.name, slug: d.slug, baseUrl: d.baseUrl || "", authType: d.authType,
              supportsImage: d.supportsImage, supportsVideo: d.supportsVideo, supportsEdit: d.supportsEdit,
              sortOrder: String(d.sortOrder),
            })}
            autoSlug={autoSlug} />
        </Modal>
      )}

      {/* Edit modal */}
      {editingProvider && (
        <Modal title={`แก้ไข Provider · ${editingProvider.name}`} onClose={() => setEditingProvider(null)} onSave={handleEdit}>
          <ProviderForm
            data={editingProvider}
            setData={(d) => setEditingProvider({
              ...editingProvider,
              name: d.name, slug: d.slug, baseUrl: d.baseUrl ?? "",
              authType: d.authType,
              supportsImage: d.supportsImage, supportsVideo: d.supportsVideo, supportsEdit: d.supportsEdit,
              sortOrder: typeof d.sortOrder === "string" ? (parseInt(d.sortOrder) || 0) : d.sortOrder,
            })}
            autoSlug={autoSlug} />
        </Modal>
      )}
    </div>
  );
}

// Helpers for table cells
function th(align: "left" | "center" | "right" = "left"): React.CSSProperties {
  return {
    textAlign: align, padding: "12px 16px",
    color: "#94a3b8", fontWeight: 500, fontSize: 11,
    letterSpacing: "0.06em", textTransform: "uppercase",
  };
}
function td(align: "left" | "center" | "right" = "left", color = "#e2e8f0"): React.CSSProperties {
  return { textAlign: align, padding: "14px 16px", color, fontSize: 13 };
}
