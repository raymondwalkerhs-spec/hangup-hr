export type StaffOption = {
  username: string;
  employeeId?: string;
  name?: string;
  role?: string;
};

export function staffOptionLabel(o: StaffOption) {
  const id = o.employeeId || o.username;
  const display = o.name || o.username;
  const role = o.role ? ` · ${o.role.toUpperCase()}` : "";
  return `${id} (${display})${role}`;
}

export function staffOptionsWithCurrent(options: StaffOption[], current?: string): StaffOption[] {
  const value = String(current || "").trim();
  if (!value) return options;
  if (options.some((o) => o.username === value || o.employeeId === value)) return options;
  return [{ username: value, name: value, employeeId: value }, ...options];
}
