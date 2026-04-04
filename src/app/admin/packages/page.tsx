"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  CreditCard,
  Plus,
  RefreshCw,
  Edit2,
  ToggleLeft,
  ToggleRight,
  Star,
  StarOff,
  Coins,
  Gift,
  Tag,
  BadgePercent,
} from "lucide-react";

interface CreditPackage {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  credits: number;
  bonusCredits: number;
  priceThb: number;
  priceUsd: number;
  badge: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

const defaultNewPackage = {
  name: "",
  slug: "",
  description: "",
  credits: "100",
  bonusCredits: "0",
  priceThb: "0",
  priceUsd: "0",
  badge: "",
  sortOrder: "0",
};

export default function PackagesPage() {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPackage, setEditingPackage] = useState<CreditPackage | null>(
    null
  );
  const [newPackage, setNewPackage] = useState({ ...defaultNewPackage });

  const fetchPackages = () => {
    setLoading(true);
    fetch("/api/admin/packages")
      .then((r) => r.json())
      .then((data) => {
        setPackages(data.packages || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchPackages();
  }, []);

  const toggleActive = async (id: number, isActive: boolean) => {
    await fetch(`/api/admin/packages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchPackages();
  };

  const toggleFeatured = async (id: number, isFeatured: boolean) => {
    await fetch(`/api/admin/packages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFeatured: !isFeatured }),
    });
    fetchPackages();
  };

  const handleAdd = async () => {
    await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newPackage,
        credits: parseInt(newPackage.credits) || 100,
        bonusCredits: parseInt(newPackage.bonusCredits) || 0,
        priceThb: parseFloat(newPackage.priceThb) || 0,
        priceUsd: parseFloat(newPackage.priceUsd) || 0,
        sortOrder: parseInt(newPackage.sortOrder) || 0,
      }),
    });
    setShowAddModal(false);
    setNewPackage({ ...defaultNewPackage });
    fetchPackages();
  };

  const handleEdit = async () => {
    if (!editingPackage) return;
    await fetch(`/api/admin/packages/${editingPackage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editingPackage.name,
        slug: editingPackage.slug,
        description: editingPackage.description,
        credits: editingPackage.credits,
        bonusCredits: editingPackage.bonusCredits,
        priceThb: editingPackage.priceThb,
        priceUsd: editingPackage.priceUsd,
        badge: editingPackage.badge,
        sortOrder: editingPackage.sortOrder,
      }),
    });
    setEditingPackage(null);
    fetchPackages();
  };

  const autoSlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const formatThb = (n: number) =>
    new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      minimumFractionDigits: 0,
    }).format(n);

  const formatUsd = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(n);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary-light" />
            แพ็กเกจเครดิต
          </h1>
          <p className="text-sm text-muted mt-1">
            จัดการแพ็กเกจเครดิตสำหรับขาย
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchPackages}
            className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> เพิ่มแพ็กเกจ
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {!loading && packages.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted">แพ็กเกจทั้งหมด</span>
              <CreditCard className="w-4 h-4 text-primary-light" />
            </div>
            <div className="text-2xl font-bold">{packages.length}</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted">เปิดใช้งาน</span>
              <ToggleRight className="w-4 h-4 text-success" />
            </div>
            <div className="text-2xl font-bold">
              {packages.filter((p) => p.isActive).length}
            </div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted">แนะนำ</span>
              <Star className="w-4 h-4 text-warning fill-warning" />
            </div>
            <div className="text-2xl font-bold">
              {packages.filter((p) => p.isFeatured).length}
            </div>
          </div>
        </div>
      )}

      {/* Packages Table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">สถานะ</th>
              <th className="text-left p-3 text-muted font-medium">ชื่อแพ็กเกจ</th>
              <th className="text-left p-3 text-muted font-medium">Slug</th>
              <th className="text-center p-3 text-muted font-medium">เครดิต</th>
              <th className="text-center p-3 text-muted font-medium">โบนัส</th>
              <th className="text-center p-3 text-muted font-medium">ราคา (THB)</th>
              <th className="text-center p-3 text-muted font-medium">ราคา (USD)</th>
              <th className="text-center p-3 text-muted font-medium">แนะนำ</th>
              <th className="text-right p-3 text-muted font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted">
                  กำลังโหลด...
                </td>
              </tr>
            ) : packages.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted">
                  ยังไม่มีแพ็กเกจ — กด &quot;เพิ่มแพ็กเกจ&quot;
                  เพื่อเริ่มต้น
                </td>
              </tr>
            ) : (
              packages.map((pkg) => (
                <tr
                  key={pkg.id}
                  className="border-b border-border/50 hover:bg-surface-light/30 transition-colors"
                >
                  <td className="p-3">
                    {pkg.isActive ? (
                      <ToggleRight className="w-4 h-4 text-success" />
                    ) : (
                      <ToggleLeft className="w-4 h-4 text-muted" />
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{pkg.name}</span>
                      {pkg.badge && (
                        <span className="px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
                          {pkg.badge}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-surface-light text-xs font-mono">
                      {pkg.slug}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className="flex items-center justify-center gap-1">
                      <Coins className="w-3 h-3 text-warning" />{" "}
                      {pkg.credits.toLocaleString()}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {pkg.bonusCredits > 0 ? (
                      <span className="flex items-center justify-center gap-1 text-success">
                        <Gift className="w-3 h-3" /> +
                        {pkg.bonusCredits.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="p-3 text-center font-medium">
                    {formatThb(pkg.priceThb)}
                  </td>
                  <td className="p-3 text-center text-muted">
                    {formatUsd(pkg.priceUsd)}
                  </td>
                  <td className="p-3 text-center">
                    {pkg.isFeatured ? (
                      <Star className="w-4 h-4 text-warning mx-auto fill-warning" />
                    ) : (
                      <StarOff className="w-4 h-4 text-muted mx-auto" />
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleActive(pkg.id, pkg.isActive)}
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all"
                        title={pkg.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                      >
                        {pkg.isActive ? (
                          <ToggleRight className="w-4 h-4 text-success" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      <button
                        onClick={() =>
                          toggleFeatured(pkg.id, pkg.isFeatured)
                        }
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all"
                        title={
                          pkg.isFeatured
                            ? "ยกเลิกแนะนำ"
                            : "ตั้งเป็นแนะนำ"
                        }
                      >
                        {pkg.isFeatured ? (
                          <Star className="w-4 h-4 text-warning fill-warning" />
                        ) : (
                          <StarOff className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingPackage({ ...pkg })}
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all"
                        title="แก้ไข"
                      >
                        <Edit2 className="w-4 h-4 text-primary-light" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setShowAddModal(false)}
        >
          <motion.div
            className="glass rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">เพิ่มแพ็กเกจเครดิต</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">
                  ชื่อแพ็กเกจ
                </label>
                <input
                  value={newPackage.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setNewPackage({
                      ...newPackage,
                      name,
                      slug: newPackage.slug === autoSlug(newPackage.name) || newPackage.slug === ""
                        ? autoSlug(name)
                        : newPackage.slug,
                    });
                  }}
                  placeholder="เช่น Starter Pack"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Slug</label>
                <input
                  value={newPackage.slug}
                  onChange={(e) =>
                    setNewPackage({ ...newPackage, slug: e.target.value })
                  }
                  placeholder="starter-pack"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  คำอธิบาย
                </label>
                <textarea
                  value={newPackage.description}
                  onChange={(e) =>
                    setNewPackage({
                      ...newPackage,
                      description: e.target.value,
                    })
                  }
                  placeholder="รายละเอียดแพ็กเกจ..."
                  rows={2}
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    เครดิต
                  </label>
                  <input
                    value={newPackage.credits}
                    onChange={(e) =>
                      setNewPackage({ ...newPackage, credits: e.target.value })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    โบนัสเครดิต
                  </label>
                  <input
                    value={newPackage.bonusCredits}
                    onChange={(e) =>
                      setNewPackage({
                        ...newPackage,
                        bonusCredits: e.target.value,
                      })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    ราคา (THB)
                  </label>
                  <input
                    value={newPackage.priceThb}
                    onChange={(e) =>
                      setNewPackage({
                        ...newPackage,
                        priceThb: e.target.value,
                      })
                    }
                    type="number"
                    step="0.01"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    ราคา (USD)
                  </label>
                  <input
                    value={newPackage.priceUsd}
                    onChange={(e) =>
                      setNewPackage({
                        ...newPackage,
                        priceUsd: e.target.value,
                      })
                    }
                    type="number"
                    step="0.01"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Badge (ถ้ามี)
                  </label>
                  <input
                    value={newPackage.badge}
                    onChange={(e) =>
                      setNewPackage({ ...newPackage, badge: e.target.value })
                    }
                    placeholder="เช่น ยอดนิยม, คุ้มสุด"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Sort Order
                  </label>
                  <input
                    value={newPackage.sortOrder}
                    onChange={(e) =>
                      setNewPackage({
                        ...newPackage,
                        sortOrder: e.target.value,
                      })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleAdd}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium"
              >
                บันทึก
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit Modal */}
      {editingPackage && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setEditingPackage(null)}
        >
          <motion.div
            className="glass rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">
              แก้ไขแพ็กเกจ: {editingPackage.name}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">
                  ชื่อแพ็กเกจ
                </label>
                <input
                  value={editingPackage.name}
                  onChange={(e) =>
                    setEditingPackage({
                      ...editingPackage,
                      name: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Slug</label>
                <input
                  value={editingPackage.slug}
                  onChange={(e) =>
                    setEditingPackage({
                      ...editingPackage,
                      slug: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  คำอธิบาย
                </label>
                <textarea
                  value={editingPackage.description || ""}
                  onChange={(e) =>
                    setEditingPackage({
                      ...editingPackage,
                      description: e.target.value,
                    })
                  }
                  rows={2}
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    เครดิต
                  </label>
                  <input
                    value={editingPackage.credits}
                    onChange={(e) =>
                      setEditingPackage({
                        ...editingPackage,
                        credits: parseInt(e.target.value) || 0,
                      })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    โบนัสเครดิต
                  </label>
                  <input
                    value={editingPackage.bonusCredits}
                    onChange={(e) =>
                      setEditingPackage({
                        ...editingPackage,
                        bonusCredits: parseInt(e.target.value) || 0,
                      })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    ราคา (THB)
                  </label>
                  <input
                    value={editingPackage.priceThb}
                    onChange={(e) =>
                      setEditingPackage({
                        ...editingPackage,
                        priceThb: parseFloat(e.target.value) || 0,
                      })
                    }
                    type="number"
                    step="0.01"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    ราคา (USD)
                  </label>
                  <input
                    value={editingPackage.priceUsd}
                    onChange={(e) =>
                      setEditingPackage({
                        ...editingPackage,
                        priceUsd: parseFloat(e.target.value) || 0,
                      })
                    }
                    type="number"
                    step="0.01"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Badge
                  </label>
                  <input
                    value={editingPackage.badge || ""}
                    onChange={(e) =>
                      setEditingPackage({
                        ...editingPackage,
                        badge: e.target.value,
                      })
                    }
                    placeholder="เช่น ยอดนิยม"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Sort Order
                  </label>
                  <input
                    value={editingPackage.sortOrder}
                    onChange={(e) =>
                      setEditingPackage({
                        ...editingPackage,
                        sortOrder: parseInt(e.target.value) || 0,
                      })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingPackage(null)}
                className="px-4 py-2 rounded-lg text-sm text-muted hover:text-foreground"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleEdit}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium"
              >
                บันทึก
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
