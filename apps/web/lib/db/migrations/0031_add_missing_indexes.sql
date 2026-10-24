CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_employee_id_idx" ON "audit_log" USING btree ("actor_employee_id");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "deliverables_objective_id_idx" ON "deliverables" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "employees_manager_id_idx" ON "employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employees_team_idx" ON "employees" USING btree ("team");--> statement-breakpoint
CREATE INDEX "enquiries_client_id_idx" ON "enquiries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "hr_document_acknowledgements_employee_id_idx" ON "hr_document_acknowledgements" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "incidents_affected_employee_id_idx" ON "incidents" USING btree ("affected_employee_id");--> statement-breakpoint
CREATE INDEX "leave_requests_leave_type_id_idx" ON "leave_requests" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "one_to_ones_manager_employee_id_idx" ON "one_to_ones" USING btree ("manager_employee_id");