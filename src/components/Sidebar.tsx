import { useMindMapStore } from "../store";
import type { SidebarTab } from "../types";
import TabProperties from "./TabProperties";
import TabReminders from "./TabReminders";
import TabStyle from "./TabStyle";
import TabOutline from "./TabOutline";
import "./Sidebar.css";

const TABS: { id: SidebarTab; label: string; short: string }[] = [
  { id: "properties", label: "面板", short: "面" },
  { id: "reminders", label: "提醒", short: "提" },
  { id: "style", label: "样式", short: "样" },
  { id: "outline", label: "大纲", short: "纲" },
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
            {t.short}
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
