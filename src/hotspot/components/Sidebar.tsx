import { Atom, LayoutDashboard, Wind, BookOpen, History, Radiation, Boxes } from "lucide-react";
import type { ViewName } from "../App";

interface SidebarProps {
  activeView: ViewName;
  onNavigate: (view: ViewName) => void;
}

const NAV_ITEMS: { id: ViewName; label: string; icon: typeof Atom; description: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, description: "Overview & status" },
  { id: "modeler", label: "Plume Modeler", icon: Wind, description: "Dispersion calculations" },
  { id: "plume3d", label: "3D Plume Simulator", icon: Boxes, description: "Three.js WebGL model" },
  { id: "isotopes", label: "Isotope Library", icon: BookOpen, description: "Radiological data" },
  { id: "history", label: "History", icon: History, description: "Calculation log" },
];

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  return (
    <aside
      className="flex flex-col w-60 flex-shrink-0 border-r"
      style={{ backgroundColor: "var(--bg-secondary)", borderColor: "var(--border-default)" }}
    >
      <div
        className="px-5 py-5 border-b flex items-center gap-3"
        style={{ borderColor: "var(--border-default)" }}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "rgba(6, 182, 212, 0.12)" }}
        >
          <Radiation className="w-6 h-6" style={{ color: "var(--accent)" }} />
        </div>
        <div className="min-w-0">
          <div
            className="text-sm font-bold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            HotSpot
          </div>
          <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            Dispersion Studio
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all duration-150 group ${
                isActive ? "" : "hover:bg-opacity-50"
              }`}
              style={{
                backgroundColor: isActive ? "rgba(6, 182, 212, 0.1)" : "transparent",
              }}
            >
              <Icon
                className="w-5 h-5 flex-shrink-0 transition-colors"
                style={{ color: isActive ? "var(--accent)" : "var(--text-tertiary)" }}
              />
              <div className="min-w-0">
                <div
                  className="text-sm font-medium"
                  style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}
                >
                  {item.label}
                </div>
                <div className="text-xs truncate" style={{ color: "var(--text-tertiary)" }}>
                  {item.description}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border-default)" }}>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span>Engine ready</span>
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
          Offline mode · v1.0.0
        </div>
      </div>
    </aside>
  );
}
