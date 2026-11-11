import type { ReactNode } from "react";
import { Archive, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import { Button } from "./ui/button";
import { AuthLayoutSkeleton } from "./AuthLayoutSkeleton";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { isLoading, user } = useAuth();
  if (isLoading) return <AuthLayoutSkeleton />;
  if (!user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6 py-12">
        <section className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Archive className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-xl font-bold tracking-tight">
              ArchiveShelf
            </span>
          </div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Private research workspace
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Your sources, ready to search.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Sign in to import authorized media, keep a transcript library, and
            download audio-only exports.
          </p>
          <Button
            className="mt-8 h-12 w-full"
            onClick={() => {
              window.location.href = LOGIN_PATH;
            }}
          >
            Continue to sign in <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </section>
      </main>
    );
  }
  return children;
}
