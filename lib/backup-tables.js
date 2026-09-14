/**
 * Supabase tables included in a full database backup.
 */
const BACKUP_TABLES = [
  "employees", "employment_periods", "app_config", "position_rates", "position_rate_monthly",
  "attendance_events", "bonus_events", "deduction_events", "payroll_adjustments",
  "commission_types", "commission_tiers", "employee_loans", "loan_payments", "loan_month_overrides",
  "loan_schedule_lines",
  "office_po_items", "office_po_month_meta", "office_po_month_lines", "office_po_purchases",
  "payroll_splits",
  "employee_documents", "employee_warnings", "payroll_month_locks", "change_log",
  "app_users", "app_sessions", "app_role_permissions", "app_user_permissions",
  "org_teams", "org_unit_managers", "action_improvement_plans", "onboarding_checklists",
  "offboarding_checklists", "clearance_items", "equipment", "equipment_assignments",
  "leave_requests", "public_holidays", "agent_training_programs", "agent_training_phases",
  "sales", "sales_attachments", "sales_visibility_grants", "sales_field_permissions",
  "sales_attachment_permissions", "sales_action_permissions", "sales_list_column_config",
  "rpm_sales", "rpm_sales_attachments", "rpm_sales_field_permissions",
  "rpm_sales_attachment_permissions", "rpm_sales_action_permissions", "rpm_sales_list_column_config",
  "rpm_team_week_targets",
  "rpm_checks",
  "team_dashboard_agent_notes",
  "sales_clients",
  "sales_client_products", "sales_client_product_prices", "bonus_requests", "expense_requests",
  "petty_cash_funds", "petty_cash_ledger", "monthly_bills", "app_notifications",
  "announcements", "announcement_reads", "coaching_tickets",
  "notification_routing_rules", "employee_quality_notes", "registration_daily_pins",
  "agent_registration_requests", "loan_requests", "saved_reports", "attendance_imports",
  "break_schedules", "break_takes", "break_config", "app_settings_revision", "app_versions",
];

const SALES_ATTACHMENT_KINDS = ["recording", "raw_call", "quality_record", "confirmation", "receipt"];
const RPM_ATTACHMENT_KINDS = ["recording", "quality_record", "raw_call"];

module.exports = { BACKUP_TABLES, SALES_ATTACHMENT_KINDS, RPM_ATTACHMENT_KINDS };
