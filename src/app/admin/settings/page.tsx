"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Settings,
  RefreshCw,
  Save,
  Plus,
  ChevronDown,
  ChevronRight,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Type,
  Hash,
  ToggleLeft,
  ToggleRight,
  FileText,
  Code,
} from "lucide-react";

interface AiSetting {
  id: number;
  key: string;
  value: string | null;
  type: string;
  group: string;
}

interface GroupChanges {
  [key: string]: string | null;
}

const typeIcons: Record<string, React.ReactNode> = {
  string: <Type className="w-3 h-3" />,
  number: <Hash className="w-3 h-3" />,
  boolean: <ToggleRight className="w-3 h-3" />,
  text: <FileText className="w-3 h-3" />,
  json: <Code className="w-3 h-3" />,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<AiSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Record<string, GroupChanges>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, "success" | "error">>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSetting, setNewSetting] = useState({
    key: "",
    value: "",
    type: "string",
    group: "general",
  });

  const fetchSettings = () => {
    setLoading(true);
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.settings || []);
        setLoading(false);
        // Auto-expand all groups on first load
        const groups = new Set<string>((data.settings || []).map((s: AiSetting) => s.group));
        setExpandedGroups(groups);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const groupedSettings = useMemo(() => {
    const grouped: Record<string, AiSetting[]> = {};
    for (const s of settings) {
      if (!grouped[s.group]) grouped[s.group] = [];
      grouped[s.group].push(s);
    }
    // Sort groups alphabetically, but keep "general" first
    return Object.entries(grouped).sort(([a], [b]) => {
      if (a === "general") return -1;
      if (b === "general") return 1;
      return a.localeCompare(b);
    });
  }, [settings]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const updateValue = (group: string, key: string, value: string | null) => {
    setChanges((prev) => ({
      ...prev,
      [group]: {
        ...(prev[group] || {}),
        [key]: value,
      },
    }));
  };

  const getDisplayValue = (setting: AiSetting) => {
    const groupChanges = changes[setting.group];
    if (groupChanges && setting.key in groupChanges) {
      return groupChanges[setting.key];
    }
    return setting.value;
  };

  const hasChanges = (group: string) => {
    return changes[group] && Object.keys(changes[group]).length > 0;
  };

  const saveGroup = async (group: string) => {
    const groupChanges = changes[group];
    if (!groupChanges || Object.keys(groupChanges).length === 0) return;

    setSaving(group);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group, settings: groupChanges }),
      });

      if (res.ok) {
        setSaveStatus((prev) => ({ ...prev, [group]: "success" }));
        setChanges((prev) => {
          const next = { ...prev };
          delete next[group];
          return next;
        });
        fetchSettings();
      } else {
        setSaveStatus((prev) => ({ ...prev, [group]: "error" }));
      }
    } catch {
      setSaveStatus((prev) => ({ ...prev, [group]: "error" }));
    }
    setSaving(null);

    // Clear status after 3 seconds
    setTimeout(() => {
      setSaveStatus((prev) => {
        const next = { ...prev };
        delete next[group];
        return next;
      });
    }, 3000);
  };

  const handleAdd = async () => {
    await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newSetting),
    });
    setShowAddModal(false);
    setNewSetting({ key: "", value: "", type: "string", group: "general" });
    fetchSettings();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("คุณแน่ใจหรือไม่ที่จะลบการตั้งค่านี้?")) return;
    await fetch(`/api/admin/settings/${id}`, { method: "DELETE" });
    fetchSettings();
  };

  const renderInput = (setting: AiSetting) => {
    const value = getDisplayValue(setting) ?? "";

    switch (setting.type) {
      case "boolean":
        return (
          <button
            onClick={() =>
              updateValue(
                setting.group,
                setting.key,
                value === "true" ? "false" : "true"
              )
            }
            className="flex items-center gap-2"
          >
            {value === "true" ? (
              <ToggleRight className="w-6 h-6 text-success" />
            ) : (
              <ToggleLeft className="w-6 h-6 text-muted" />
            )}
            <span className="text-xs text-muted">
              {value === "true" ? "เปิด" : "ปิด"}
            </span>
          </button>
        );
      case "number":
        return (
          <input
            type="number"
            value={value}
            onChange={(e) =>
              updateValue(setting.group, setting.key, e.target.value)
            }
            className="w-full p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        );
      case "text":
        return (
          <textarea
            value={value}
            onChange={(e) =>
              updateValue(setting.group, setting.key, e.target.value)
            }
            rows={3}
            className="w-full p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none font-mono"
          />
        );
      case "json":
        return (
          <textarea
            value={value}
            onChange={(e) =>
              updateValue(setting.group, setting.key, e.target.value)
            }
            rows={4}
            className="w-full p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none font-mono text-xs"
          />
        );
      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) =>
              updateValue(setting.group, setting.key, e.target.value)
            }
            className="w-full p-2 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        );
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="w-6 h-6 text-primary-light" />
            ตั้งค่าระบบ
          </h1>
          <p className="text-sm text-muted mt-1">
            จัดการค่าคอนฟิกของระบบ AI (ai_settings)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchSettings}
            className="p-2 rounded-lg glass-light hover:bg-surface-light transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> เพิ่มการตั้งค่า
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : settings.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted">
          ยังไม่มีการตั้งค่า — กด &quot;เพิ่มการตั้งค่า&quot; เพื่อเริ่มต้น
        </div>
      ) : (
        <div className="space-y-4">
          {groupedSettings.map(([group, groupSettings]) => (
            <div key={group} className="glass rounded-xl overflow-hidden">
              {/* Group Header */}
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between p-4 hover:bg-surface-light/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {expandedGroups.has(group) ? (
                    <ChevronDown className="w-4 h-4 text-muted" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted" />
                  )}
                  <h3 className="font-semibold capitalize">{group}</h3>
                  <span className="text-xs text-muted px-2 py-0.5 rounded-full bg-surface-light">
                    {groupSettings.length} รายการ
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {saveStatus[group] === "success" && (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="w-3.5 h-3.5" /> บันทึกแล้ว
                    </span>
                  )}
                  {saveStatus[group] === "error" && (
                    <span className="flex items-center gap-1 text-xs text-error">
                      <AlertCircle className="w-3.5 h-3.5" /> เกิดข้อผิดพลาด
                    </span>
                  )}
                  {hasChanges(group) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        saveGroup(group);
                      }}
                      disabled={saving === group}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary to-secondary text-white text-xs font-medium disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving === group ? "กำลังบันทึก..." : "บันทึก"}
                    </button>
                  )}
                </div>
              </button>

              {/* Group Settings */}
              {expandedGroups.has(group) && (
                <div className="border-t border-border">
                  {groupSettings.map((setting) => (
                    <div
                      key={setting.id}
                      className="flex items-start gap-4 p-4 border-b border-border/50 last:border-0 hover:bg-surface-light/20 transition-colors"
                    >
                      <div className="shrink-0 mt-1">
                        <span
                          className="flex items-center justify-center w-6 h-6 rounded-md bg-surface-light text-muted"
                          title={setting.type}
                        >
                          {typeIcons[setting.type] || typeIcons.string}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-medium font-mono">
                            {setting.key}
                          </span>
                          <span className="text-[10px] text-muted px-1.5 py-0.5 rounded bg-surface-light">
                            {setting.type}
                          </span>
                        </div>
                        {renderInput(setting)}
                      </div>
                      <button
                        onClick={() => handleDelete(setting.id)}
                        className="shrink-0 p-1.5 rounded-lg hover:bg-surface-light transition-all mt-1"
                        title="ลบ"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-error" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Setting Modal */}
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
            <h3 className="text-lg font-bold mb-4">เพิ่มการตั้งค่า</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted mb-1 block">Key</label>
                <input
                  value={newSetting.key}
                  onChange={(e) =>
                    setNewSetting({ ...newSetting, key: e.target.value })
                  }
                  placeholder="เช่น default_model, max_generations_per_day"
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Value</label>
                <input
                  value={newSetting.value}
                  onChange={(e) =>
                    setNewSetting({ ...newSetting, value: e.target.value })
                  }
                  className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted mb-1 block">Type</label>
                  <select
                    value={newSetting.type}
                    onChange={(e) =>
                      setNewSetting({ ...newSetting, type: e.target.value })
                    }
                    className="w-full p-2.5 rounded-lg bg-surface-light text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="text">Text (multi-line)</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted mb-1 block">
                    Group
                  </label>
                  <input
                    value={newSetting.group}
                    onChange={(e) =>
                      setNewSetting({ ...newSetting, group: e.target.value })
                    }
                    placeholder="general"
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
    </div>
  );
}
