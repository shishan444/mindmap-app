import { useMindMapStore } from "../store";
import type { SidebarTab } from "../types";
import TabProperties from "./TabProperties";
import TabReminders from "./TabReminders";
import TabStyle from "./TabStyle";
import TabOutline from "./TabOutline";
import "./Sidebar.css";

const TABS: { id: SidebarTab; icon: string; label: string }[] = [
  { id: "properties", icon: "📌", label: "属性" },
  { id: "reminders", icon: "⏰", label: "提醒" },
  { id: "style", icon: "🎨", label: "样式" },
  { id: "outline", icon: "📋", label: "大纲" },
];

export default function Sidebar() {
  const activeTab = useMindMapStore((s) => s.activeTab);
  const setActiveTab = useMindMapStore((s) => s.setActiveTab);
  const collapsed = useMindMapStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useMindMapStore((s) => s.toggleSidebar);
  const width = useMindMapStore((s) => s.sidebarWidth);

  if (collapsed) {
    return (
      <div className="sidebar-collapsed">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="sidebar-tab-icon"
            title={t.label}
            onClick={() => {
              toggleSidebar();
              setActiveTab(t.id);
            }}
          >
            {t.icon}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`sidebar-tab ${activeTab === t.id ? "active" : ""}`}
            onClick={() => setActiveTab(t.id)}
            title={t.label}
          >
            <span className="sidebar-tab-icon-static">{t.icon}</span>
            <span className="sidebar-tab-label">{t.label}</span>
          </button>
        ))}
        <button
          className="sidebar-collapse-btn"
          onClick={toggleSidebar}
          title="折叠侧栏"
        >
          »
        </button>
      </div>
      <div className="sidebar-content">
        {activeTab === "properties" && <TabProperties />}
        {activeTab === "reminders" && <TabReminders />}
        {activeTab === "style" && <TabStyle />}
        {activeTab === "outline" && <TabOutline />}
      </div>
    </div>
  );
}
