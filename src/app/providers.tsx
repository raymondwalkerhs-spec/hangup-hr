import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "./AuthProvider";
import { AppRouter } from "./router";
import { useEffect } from "react";
import { useThemeStore } from "@/stores/theme-store";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function ThemeInit() {
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return null;
}

export function AppProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeInit />
        <AppRouter />
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
