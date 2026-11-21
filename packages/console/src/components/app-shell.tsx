"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ActivityIcon, ChatIcon, ProjectsIcon } from "./icons";

const NAV_ITEMS = [
  { href: "/", label: "消息", icon: ChatIcon },
  { href: "/projects", label: "项目", icon: ProjectsIcon },
  { href: "/activity", label: "动态", icon: ActivityIcon },
] as const;

function isActive(href: string, pathname: string): boolean {
  if (href === "/") {
    return pathname === "/" || (pathname.startsWith("/projects/") && pathname !== "/projects");
  }
  if (href === "/projects") {
    return pathname === "/projects";
  }
  return pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const conversation = /^\/projects\/[^/]+\/tasks\/[^/]+/.test(pathname);

  return (
    <div className={`app-shell${conversation ? " chat-focus" : ""}`}>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            a<span>×</span>a
          </span>
          <span className="brand-copy">
            <strong>axa</strong>
            <span>本地任务中枢</span>
          </span>
        </Link>

        <nav className="side-nav" aria-label="主导航">
          <span className="side-label">工作区</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className={`nav-item${isActive(item.href, pathname) ? " active" : ""}`}
                href={item.href}
                key={item.href}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-note">
          <span className="local-dot" />
          <div>
            <strong>本地运行</strong>
            <p>文件系统即真相源</p>
          </div>
        </div>

        <div className="sidebar-foot">
          <span>.axa/</span>
          <span>v0.1.0</span>
        </div>
      </aside>

      <div className="app-main">
        <main className={`page${conversation ? " page--chat" : ""}`}>{children}</main>
      </div>

      {conversation ? null : (
        <nav className="mobile-tabs" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className={`mobile-tab${isActive(item.href, pathname) ? " active" : ""}`}
                href={item.href}
                key={item.href}
              >
                <Icon size={22} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
