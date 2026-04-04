"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Server,
  Plus,
  RefreshCw,
  Edit2,
  ToggleLeft,
  ToggleRight,
  Image as ImageIcon,
  Video,
  Paintbrush,
  GripVertical,
  Globe,
  Key,
} from "lucide-react";

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

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [newProvider, setNewProvider] = useState({ ...defaultNewProvider });

  const fetchProviders = () => {
    setLoading(true);
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const toggleActive = async (id: number, isActive: boolean) => {
    await fetch(`/api/admin/providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchProviders();
  };

  const handleAdd = async () => {
    await fetch("/api/admin/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newProvider,
        sortOrder: parseInt(newProvider.sortOrder) || 0,
      }),
    });
    setShowAddModal(false);
    setNewProvider({ ...defaultNewProvider });
    fetchProviders();
  };

  const handleEdit = async () => {
    if (!editingProvider) return;
    await fetch(`/api/admin/providers/${editingProvider.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editingProvider.name,
        slug: editingProvider.slug,
        baseUrl: editingProvider.baseUrl,
        authType: editingProvider.authType,
        supportsImage: editingProvider.supportsImage,
        supportsVideo: editingProvider.supportsVideo,
        supportsEdit: editingProvider.supportsEdit,
        sortOrder: editingProvider.sortOrder,
      }),
    });
    setEditingProvider(null);
    fetchProviders();
  };

  const autoSlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="w-6 h-6 text-primary-light" />
            Providers
          </h1>
          <p className="text-sm text-muted mt-1">
            จัดการ AI providers ทั้งหมด
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchProviders}
            className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> เพิ่ม Provider
          </button>
        </div>
      </div>

      {/* Auth Type Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-muted">
        <span className="flex items-center gap-1">
          <Key className="w-3 h-3" /> bearer = Bearer Token
        </span>
        <span className="flex items-center gap-1">
          <Key className="w-3 h-3" /> api_key = API Key Header
        </span>
        <span className="flex items-center gap-1">
          <Key className="w-3 h-3" /> hmac = HMAC Signature
        </span>
      </div>

      {/* Providers Table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">สถานะ</th>
              <th className="text-left p-3 text-muted font-medium">
                Provider
              </th>
              <th className="text-left p-3 text-muted font-medium">Slug</th>
              <th className="text-center p-3 text-muted font-medium">
                Auth Type
              </th>
              <th className="text-center p-3 text-muted font-medium">
                ความสามารถ
              </th>
              <th className="text-center p-3 text-muted font-medium">
                ลำดับ
              </th>
              <th className="text-right p-3 text-muted font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted">
                  กำลังโหลด...
                </td>
              </tr>
            ) : providers.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted">
                  ยังไม่มี provider — กด &quot;เพิ่ม Provider&quot;
                  เพื่อเริ่มต้น
                </td>
              </tr>
            ) : (
              providers.map((prov) => (
                <tr
                  key={prov.id}
                  className="border-b border-border/50 hover:bg-surface-light/30 transition-colors"
                >
                  <td className="p-3">
                    {prov.isActive ? (
                      <ToggleRight className="w-4 h-4 text-success" />
                    ) : (
                      <ToggleLeft className="w-4 h-4 text-muted" />
                    )}
                  </td>
                  <td className="p-3 font-medium">{prov.name}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-surface-light text-xs font-mono">
                      {prov.slug}
                    </span>
                  </td>
                  <td className="p-3 text-center text-xs">{prov.authType}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1.5">
                      {prov.supportsImage && (
                        <span
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-xs"
                          title="Image"
                        >
                          <ImageIcon className="w-3 h-3" /> Image
                        </span>
                      )}
                      {prov.supportsVideo && (
                        <span
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-xs"
                          title="Video"
                        >
                          <Video className="w-3 h-3" /> Video
                        </span>
                      )}
                      {prov.supportsEdit && (
                        <span
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-xs"
                          title="Edit"
                        >
                          <Paintbrush className="w-3 h-3" /> Edit
                        </span>
                      )}
                      {!prov.supportsImage &&
                        !prov.supportsVideo &&
                        !prov.supportsEdit && (
                          <span className="text-xs text-muted">-</span>
                        )}
                    </div>
                  </td>
                  <td className="p-3 text-center">
                    <span className="flex items-center justify-center gap-1 text-muted">
                      <GripVertical className="w-3 h-3" /> {prov.sortOrder}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleActive(prov.id, prov.isActive)}
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all"
                        title={prov.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                      >
                        {prov.isActive ? (
                          <ToggleRight className="w-4 h-4 text-success" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingProvider({ ...prov })}
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
            className="glass rounded-2xl p-6 w-full max-w-md"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">เพิ่ม Provider</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">
                  ชื่อ Provider
                </label>
                <input
                  value={newProvider.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setNewProvider({
                      ...newProvider,
                      name,
                      slug: newProvider.slug === autoSlug(newProvider.name) || newProvider.slug === ""
                        ? autoSlug(name)
                        : newProvider.slug,
                    });
                  }}
                  placeholder="เช่น BytePlus, Replicate"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Slug</label>
                <input
                  value={newProvider.slug}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, slug: e.target.value })
                  }
                  placeholder="byteplus"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Base URL
                </label>
                <input
                  value={newProvider.baseUrl}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com/v1"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Auth Type
                </label>
                <select
                  value={newProvider.authType}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, authType: e.target.value })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="bearer">Bearer Token</option>
                  <option value="api_key">API Key Header</option>
                  <option value="hmac">HMAC Signature</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Sort Order
                </label>
                <input
                  value={newProvider.sortOrder}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, sortOrder: e.target.value })
                  }
                  type="number"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-2 block">
                  ความสามารถ
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newProvider.supportsImage}
                      onChange={(e) =>
                        setNewProvider({
                          ...newProvider,
                          supportsImage: e.target.checked,
                        })
                      }
                      className="rounded border-border"
                    />
                    <ImageIcon className="w-3.5 h-3.5 text-blue-400" /> Image
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newProvider.supportsVideo}
                      onChange={(e) =>
                        setNewProvider({
                          ...newProvider,
                          supportsVideo: e.target.checked,
                        })
                      }
                      className="rounded border-border"
                    />
                    <Video className="w-3.5 h-3.5 text-purple-400" /> Video
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newProvider.supportsEdit}
                      onChange={(e) =>
                        setNewProvider({
                          ...newProvider,
                          supportsEdit: e.target.checked,
                        })
                      }
                      className="rounded border-border"
                    />
                    <Paintbrush className="w-3.5 h-3.5 text-green-400" /> Edit
                  </label>
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
      {editingProvider && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setEditingProvider(null)}
        >
          <motion.div
            className="glass rounded-2xl p-6 w-full max-w-md"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">
              แก้ไข Provider: {editingProvider.name}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">
                  ชื่อ Provider
                </label>
                <input
                  value={editingProvider.name}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      name: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Slug</label>
                <input
                  value={editingProvider.slug}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      slug: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Base URL
                </label>
                <input
                  value={editingProvider.baseUrl || ""}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      baseUrl: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Auth Type
                </label>
                <select
                  value={editingProvider.authType}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      authType: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="bearer">Bearer Token</option>
                  <option value="api_key">API Key Header</option>
                  <option value="hmac">HMAC Signature</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Sort Order
                </label>
                <input
                  value={editingProvider.sortOrder}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      sortOrder: parseInt(e.target.value) || 0,
                    })
                  }
                  type="number"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-2 block">
                  ความสามารถ
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProvider.supportsImage}
                      onChange={(e) =>
                        setEditingProvider({
                          ...editingProvider,
                          supportsImage: e.target.checked,
                        })
                      }
                      className="rounded border-border"
                    />
                    <ImageIcon className="w-3.5 h-3.5 text-blue-400" /> Image
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProvider.supportsVideo}
                      onChange={(e) =>
                        setEditingProvider({
                          ...editingProvider,
                          supportsVideo: e.target.checked,
                        })
                      }
                      className="rounded border-border"
                    />
                    <Video className="w-3.5 h-3.5 text-purple-400" /> Video
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProvider.supportsEdit}
                      onChange={(e) =>
                        setEditingProvider({
                          ...editingProvider,
                          supportsEdit: e.target.checked,
                        })
                      }
                      className="rounded border-border"
                    />
                    <Paintbrush className="w-3.5 h-3.5 text-green-400" /> Edit
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingProvider(null)}
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
