"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Layers,
  Plus,
  RefreshCw,
  Edit2,
  ToggleLeft,
  ToggleRight,
  Star,
  StarOff,
  Filter,
  Coins,
  Image as ImageIcon,
  Video,
  Paintbrush,
} from "lucide-react";

interface AiModel {
  id: number;
  providerId: number;
  providerName: string;
  providerSlug: string;
  modelId: string;
  name: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  creditsPerUnit: number;
  costPerUnit: number;
  unitType: string;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

interface Provider {
  id: number;
  name: string;
  slug: string;
}

const defaultNewModel = {
  providerId: "",
  modelId: "",
  name: "",
  description: "",
  category: "text_to_image",
  subcategory: "",
  creditsPerUnit: "10",
  costPerUnit: "0.01",
  unitType: "per_image",
  sortOrder: "0",
};

const categoryLabels: Record<string, string> = {
  text_to_image: "Text to Image",
  image_to_image: "Image to Image",
  text_to_video: "Text to Video",
  image_to_video: "Image to Video",
  upscale: "Upscale",
  edit: "Edit",
  background_removal: "Background Removal",
};

const categoryIcon = (cat: string) => {
  if (cat.includes("video")) return <Video className="w-3 h-3" />;
  if (cat.includes("edit") || cat === "background_removal")
    return <Paintbrush className="w-3 h-3" />;
  return <ImageIcon className="w-3 h-3" />;
};

export default function ModelsPage() {
  const [models, setModels] = useState<AiModel[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingModel, setEditingModel] = useState<AiModel | null>(null);
  const [newModel, setNewModel] = useState({ ...defaultNewModel });

  const fetchModels = () => {
    setLoading(true);
    fetch("/api/admin/models")
      .then((r) => r.json())
      .then((data) => {
        setModels(data.models || []);
        setProviders(data.providers || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const categories = useMemo(
    () => [...new Set(models.map((m) => m.category))],
    [models]
  );

  const filteredModels = useMemo(() => {
    let result = models;
    if (filterCategory) result = result.filter((m) => m.category === filterCategory);
    if (filterProvider) result = result.filter((m) => String(m.providerId) === filterProvider);
    return result;
  }, [models, filterCategory, filterProvider]);

  const toggleActive = async (id: number, isActive: boolean) => {
    await fetch(`/api/admin/models/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchModels();
  };

  const toggleFeatured = async (id: number, isFeatured: boolean) => {
    await fetch(`/api/admin/models/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFeatured: !isFeatured }),
    });
    fetchModels();
  };

  const handleAdd = async () => {
    await fetch("/api/admin/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newModel,
        providerId: parseInt(newModel.providerId) || 0,
        creditsPerUnit: parseInt(newModel.creditsPerUnit) || 10,
        costPerUnit: parseFloat(newModel.costPerUnit) || 0.01,
        sortOrder: parseInt(newModel.sortOrder) || 0,
      }),
    });
    setShowAddModal(false);
    setNewModel({ ...defaultNewModel });
    fetchModels();
  };

  const handleEdit = async () => {
    if (!editingModel) return;
    await fetch(`/api/admin/models/${editingModel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editingModel.name,
        modelId: editingModel.modelId,
        category: editingModel.category,
        subcategory: editingModel.subcategory,
        creditsPerUnit: editingModel.creditsPerUnit,
        costPerUnit: editingModel.costPerUnit,
        unitType: editingModel.unitType,
        sortOrder: editingModel.sortOrder,
        description: editingModel.description,
      }),
    });
    setEditingModel(null);
    fetchModels();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary-light" />
            โมเดล AI
          </h1>
          <p className="text-sm text-muted mt-1">
            จัดการโมเดล AI ทั้งหมดที่ใช้ในระบบ
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchModels}
            className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> เพิ่มโมเดล
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <Filter className="w-4 h-4 text-muted" />
        <select
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          className="p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">ทุก Provider</option>
          {providers.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {categoryLabels[cat] || cat}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted ml-auto">
          แสดง {filteredModels.length} จาก {models.length} โมเดล
        </span>
      </div>

      {/* Models Table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3 text-muted font-medium">สถานะ</th>
              <th className="text-left p-3 text-muted font-medium">ชื่อโมเดล</th>
              <th className="text-left p-3 text-muted font-medium">Model ID</th>
              <th className="text-left p-3 text-muted font-medium">Provider</th>
              <th className="text-center p-3 text-muted font-medium">หมวดหมู่</th>
              <th className="text-center p-3 text-muted font-medium">เครดิต/หน่วย</th>
              <th className="text-center p-3 text-muted font-medium">แนะนำ</th>
              <th className="text-right p-3 text-muted font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted">
                  กำลังโหลด...
                </td>
              </tr>
            ) : filteredModels.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted">
                  {models.length === 0
                    ? 'ยังไม่มีโมเดล — กด "เพิ่มโมเดล" เพื่อเริ่มต้น'
                    : "ไม่พบโมเดลตามตัวกรอง"}
                </td>
              </tr>
            ) : (
              filteredModels.map((model) => (
                <tr
                  key={model.id}
                  className="border-b border-border/50 hover:bg-surface-light/30 transition-colors"
                >
                  <td className="p-3">
                    {model.isActive ? (
                      <ToggleRight className="w-4 h-4 text-success" />
                    ) : (
                      <ToggleLeft className="w-4 h-4 text-muted" />
                    )}
                  </td>
                  <td className="p-3 font-medium">{model.name}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-surface-light text-xs font-mono">
                      {model.modelId}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-surface-light text-xs">
                      {model.providerName}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1">
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary-light text-xs">
                        {categoryIcon(model.category)}{" "}
                        {categoryLabels[model.category] || model.category}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-center">
                    <span className="flex items-center justify-center gap-1">
                      <Coins className="w-3 h-3 text-warning" />{" "}
                      {model.creditsPerUnit}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {model.isFeatured ? (
                      <Star className="w-4 h-4 text-warning mx-auto fill-warning" />
                    ) : (
                      <StarOff className="w-4 h-4 text-muted mx-auto" />
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleActive(model.id, model.isActive)}
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all"
                        title={model.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                      >
                        {model.isActive ? (
                          <ToggleRight className="w-4 h-4 text-success" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      <button
                        onClick={() =>
                          toggleFeatured(model.id, model.isFeatured)
                        }
                        className="p-1.5 rounded-lg hover:bg-surface-light transition-all"
                        title={
                          model.isFeatured
                            ? "ยกเลิกแนะนำ"
                            : "ตั้งเป็นแนะนำ"
                        }
                      >
                        {model.isFeatured ? (
                          <Star className="w-4 h-4 text-warning fill-warning" />
                        ) : (
                          <StarOff className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingModel({ ...model })}
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
            <h3 className="text-lg font-bold mb-4">เพิ่มโมเดล AI</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Provider
                </label>
                <select
                  value={newModel.providerId}
                  onChange={(e) =>
                    setNewModel({ ...newModel, providerId: e.target.value })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">เลือก Provider</option>
                  {providers.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  ชื่อโมเดล
                </label>
                <input
                  value={newModel.name}
                  onChange={(e) =>
                    setNewModel({ ...newModel, name: e.target.value })
                  }
                  placeholder="เช่น FLUX.1 Schnell"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Model ID
                </label>
                <input
                  value={newModel.modelId}
                  onChange={(e) =>
                    setNewModel({ ...newModel, modelId: e.target.value })
                  }
                  placeholder="เช่น flux-schnell"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  หมวดหมู่
                </label>
                <select
                  value={newModel.category}
                  onChange={(e) =>
                    setNewModel({ ...newModel, category: e.target.value })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Subcategory (ถ้ามี)
                </label>
                <input
                  value={newModel.subcategory}
                  onChange={(e) =>
                    setNewModel({ ...newModel, subcategory: e.target.value })
                  }
                  placeholder="เช่น anime, realistic"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  คำอธิบาย
                </label>
                <textarea
                  value={newModel.description}
                  onChange={(e) =>
                    setNewModel({ ...newModel, description: e.target.value })
                  }
                  placeholder="รายละเอียดเกี่ยวกับโมเดล..."
                  rows={2}
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    เครดิต/หน่วย
                  </label>
                  <input
                    value={newModel.creditsPerUnit}
                    onChange={(e) =>
                      setNewModel({
                        ...newModel,
                        creditsPerUnit: e.target.value,
                      })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    ต้นทุน/หน่วย ($)
                  </label>
                  <input
                    value={newModel.costPerUnit}
                    onChange={(e) =>
                      setNewModel({
                        ...newModel,
                        costPerUnit: e.target.value,
                      })
                    }
                    type="number"
                    step="0.001"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Sort Order
                  </label>
                  <input
                    value={newModel.sortOrder}
                    onChange={(e) =>
                      setNewModel({ ...newModel, sortOrder: e.target.value })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Unit Type
                </label>
                <select
                  value={newModel.unitType}
                  onChange={(e) =>
                    setNewModel({ ...newModel, unitType: e.target.value })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="per_image">Per Image</option>
                  <option value="per_second">Per Second</option>
                  <option value="per_request">Per Request</option>
                </select>
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
      {editingModel && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setEditingModel(null)}
        >
          <motion.div
            className="glass rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">
              แก้ไขโมเดล: {editingModel.name}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">
                  ชื่อโมเดล
                </label>
                <input
                  value={editingModel.name}
                  onChange={(e) =>
                    setEditingModel({ ...editingModel, name: e.target.value })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Model ID
                </label>
                <input
                  value={editingModel.modelId}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      modelId: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  หมวดหมู่
                </label>
                <select
                  value={editingModel.category}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      category: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Subcategory
                </label>
                <input
                  value={editingModel.subcategory || ""}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      subcategory: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  คำอธิบาย
                </label>
                <textarea
                  value={editingModel.description || ""}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      description: e.target.value,
                    })
                  }
                  rows={2}
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    เครดิต/หน่วย
                  </label>
                  <input
                    value={editingModel.creditsPerUnit}
                    onChange={(e) =>
                      setEditingModel({
                        ...editingModel,
                        creditsPerUnit: parseInt(e.target.value) || 0,
                      })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    ต้นทุน/หน่วย ($)
                  </label>
                  <input
                    value={editingModel.costPerUnit}
                    onChange={(e) =>
                      setEditingModel({
                        ...editingModel,
                        costPerUnit: parseFloat(e.target.value) || 0,
                      })
                    }
                    type="number"
                    step="0.001"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Sort Order
                  </label>
                  <input
                    value={editingModel.sortOrder}
                    onChange={(e) =>
                      setEditingModel({
                        ...editingModel,
                        sortOrder: parseInt(e.target.value) || 0,
                      })
                    }
                    type="number"
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">
                  Unit Type
                </label>
                <select
                  value={editingModel.unitType}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      unitType: e.target.value,
                    })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="per_image">Per Image</option>
                  <option value="per_second">Per Second</option>
                  <option value="per_request">Per Request</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditingModel(null)}
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
