import { Navigate, useLocation } from "react-router-dom";

/** Normalize `/attendance/` → `/attendance` so nested routes match instead of the catch-all. */
export function TrailingSlashRedirect() {
  const location = useLocation();
  const { pathname, search, hash } = location;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const target = `${pathname.replace(/\/+$/, "")}${search}${hash}`;
    return <Navigate to={target} replace />;
  }
  return null;
}
