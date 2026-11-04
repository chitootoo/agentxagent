"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ActivityIcon, ProjectsIcon } from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "项目", hint: "Projects", icon: ProjectsIcon, match: "projects" },
  { href: "/activity", label: "动态", hint: "Activity", icon: ActivityIcon, match: "activity" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            a<span>×</span>a
          </span>
          <span className="brand-copy">
            <strong>axa</strong>
            <span>Agent × Agent</span>
          </span>
        </Link>

        <nav className="side-nav" aria-label="主导航">
          <span className="side-label">Workspace</span>
          {NAV_ITEMS.map((item) => {
            const active =
              item.match === "activity"
                ? pathname.startsWith("/activity")
                : !pathname.startsWith("/activity");
            const Icon = item.icon;
            return (
              <Link
                className={`nav-item${active ? " active" : ""}`}
                href={item.href}
                key={item.href}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-note">
          <span className="local-dot" />
          <div>
            <strong>Local only</strong>
            <p>文件系统即真相源</p>
          </div>
        </div>

        <div className="sidebar-foot">
          <span>.axa/</span>
          <span>v0.1.0</span>
        </div>
      </aside>
      <div className="app-main">
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
