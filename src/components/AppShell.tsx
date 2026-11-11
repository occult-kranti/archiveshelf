import { useState } from "react";
import {
  Archive,
  Download,
  Table2,
  FolderSearch,
  ListChecks,
  LogOut,
  Menu,
  Plus,
  X,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const navigation = [
  { to: "/", label: "Library", icon: FolderSearch, end: true },
  { to: "/channels", label: "Channels", icon: Table2, end: false },
  { to: "/import", label: "Import media", icon: Plus, end: false },
  { to: "/jobs", label: "Archive jobs", icon: ListChecks, end: false },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="mt-8 space-y-1" aria-label="Main navigation">
      {navigation.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )
          }
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <NavLink
      to="/"
      className="flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-primary text-primary-foreground">
        <Archive className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="text-lg font-bold tracking-tight">ArchiveShelf</span>
    </NavLink>
  );
}

export default function AppShell() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar px-4 py-5 lg:flex">
        <Brand />
        <Navigation />
        <div className="mt-auto">
          <div className="mb-5 border-t pt-5">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-green-700" /> Engine
              ready
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Audio and transcripts only. No video retained.
            </p>
          </div>
          <div className="flex items-center gap-2 border-t pt-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {user?.name || "Researcher"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email || "Signed in"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
        <Brand />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </header>
      {open && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            className="absolute inset-0 bg-black/35"
            onClick={() => setOpen(false)}
            aria-label="Close navigation overlay"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(84vw,320px)] flex-col bg-sidebar p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <Navigation onNavigate={() => setOpen(false)} />
            <Button className="mt-auto" variant="outline" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </aside>
        </div>
      )}

      <main className="min-w-0 lg:pl-60">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <Outlet />
        </div>
      </main>
      <NavLink
        to="/import"
        className="fixed bottom-5 right-5 grid h-14 w-14 place-items-center rounded-full bg-primary p-4 text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        aria-label="Import media"
      >
        <Download className="h-5 w-5" />
      </NavLink>
    </div>
  );
}
