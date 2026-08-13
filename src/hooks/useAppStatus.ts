import { useAuth } from "@/app/AuthProvider";

export type AppStatusUser = Record<string, boolean | string | undefined>;

export function useAppStatus() {
  const { status, loading, refreshStatus } = useAuth();
  return {
    status,
    user: (status?.user as AppStatusUser) || {},
    loading,
    refreshStatus,
  };
}
