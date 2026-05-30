import { BookOpen, Clock3, Home, ShoppingCart } from "lucide-react";

const tabs = [
  { label: "ホーム", href: "/store", icon: Home },
  { label: "手順書", href: "/store/procedures", icon: BookOpen },
  { label: "タイムカード", href: "/store/timecard", icon: Clock3 },
  { label: "POS", href: "/store/pos", icon: ShoppingCart }
];

export function StoreNavTabs({ active }: { active: "home" | "procedures" | "timecard" | "pos" }) {
  const activeHref = active === "home" ? "/store" : `/store/${active}`;

  return (
    <nav className="store-nav-tabs" aria-label="店舗ワークベンチ">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <a className={tab.href === activeHref ? "is-active" : ""} href={tab.href} key={tab.href}>
            <Icon size={17} />
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
