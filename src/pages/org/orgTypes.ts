export type Agent = { id: string; name: string; position?: string };
export type Team = { name: string; agents?: Agent[]; dialsSales?: boolean };
export type UnitSection = { unit: string; teams?: Team[] };
export type Employee = {
  id: string;
  american_name?: string;
  arabic_name?: string;
  unit?: string;
  team?: string;
  role?: string;
  lead_role?: string;
  status?: string;
};
export type TeamMeta = {
  id: string;
  name: string;
  unit?: string;
  tlEmployeeId?: string;
  tlEmployeeIds?: string[];
  closerEmployeeIds?: string[];
  dialsSales?: boolean;
};
