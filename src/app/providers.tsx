import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./AuthProvider";
import { AppRouter } from "./router";
import { useEffect } from "react";
import { useThemeStore } from "@/stores/theme-store";
import { ErrorBoundary } from "@/ui/ErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function ThemeInit() {
  const theme = useThemeStore((s) => s.theme);
  const ensureUnlocked = useThemeStore((s) => s.ensureUnlocked);
  const { status } = useAuth();
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => {
    const unlocks = (status as { themeUnlocks?: import("@/stores/theme-store").ThemeUnlocks } | null)?.themeUnlocks;
    if (unlocks) ensureUnlocked(unlocks);
  }, [status, ensureUnlocked]);
  return null;
}

export function AppProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeInit />
        <ErrorBoundary label="the app">
          <AppRouter />
        </ErrorBoundary>
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
