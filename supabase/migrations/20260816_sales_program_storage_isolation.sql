-- MLA vs RPM: document separate tables and storage roots (quality_record per program folder).

COMMENT ON TABLE sales IS 'MLA sales program only. RPM sales live in rpm_sales.';
COMMENT ON TABLE rpm_sales IS 'RPM sales program only. MLA sales live in sales.';
COMMENT ON TABLE sales_attachments IS 'MLA attachments. Storage: mla-sales-attachments/ or legacy sales-attachments/.';
COMMENT ON TABLE rpm_sales_attachments IS 'RPM attachments. Storage: rpm-sales-attachments/{id}/quality_record/ etc.';
COMMENT ON TABLE sales_field_permissions IS 'MLA field ACL. RPM uses rpm_sales_field_permissions.';
COMMENT ON TABLE rpm_sales_field_permissions IS 'RPM field ACL. MLA uses sales_field_permissions.';
COMMENT ON TABLE sales_attachment_permissions IS 'MLA attachment kind ACL. RPM uses rpm_sales_attachment_permissions.';
COMMENT ON TABLE rpm_sales_attachment_permissions IS 'RPM attachment kind ACL. MLA uses sales_attachment_permissions.';
COMMENT ON TABLE sales_action_permissions IS 'MLA sale actions ACL. RPM uses rpm_sales_action_permissions.';
COMMENT ON TABLE rpm_sales_action_permissions IS 'RPM sale actions ACL. MLA uses sales_action_permissions.';
COMMENT ON TABLE sales_list_column_config IS 'MLA sales list columns. RPM uses rpm_sales_list_column_config.';
COMMENT ON TABLE rpm_sales_list_column_config IS 'RPM sales list columns. MLA uses sales_list_column_config.';
