import { Home, Library, ListMusic, Search } from "lucide-react";

export type MobileTabKey = "home" | "search" | "library" | "queue";

type MobileBottomNavProps = {
  activeTab: MobileTabKey;
  onChange: (tab: MobileTabKey) => void;
};

const items: Array<{ key: MobileTabKey; label: string; icon: typeof Home }> = [
  { key: "home", label: "Home", icon: Home },
  { key: "search", label: "Search", icon: Search },
  { key: "library", label: "Library", icon: Library },
  { key: "queue", label: "Queue", icon: ListMusic },
];

export default function MobileBottomNav({ activeTab, onChange }: MobileBottomNavProps) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            className={activeTab === item.key ? "mobile-bottom-nav__item is-active" : "mobile-bottom-nav__item"}
            onClick={() => onChange(item.key)}
            aria-label={item.label}
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
