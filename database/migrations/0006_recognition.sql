CREATE TABLE "plan_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"page" integer,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_uploads_size_positive" CHECK ("plan_uploads"."width" > 0 AND "plan_uploads"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "recognition_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"method" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"draft" jsonb,
	"scale" jsonb,
	"confidence" numeric(4, 3),
	"error" text,
	"fallback_of" uuid,
	"confirmed_node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "recognition_runs_method_known" CHECK ("recognition_runs"."method" IN ('local', 'llm')),
	CONSTRAINT "recognition_runs_status_known" CHECK ("recognition_runs"."status" IN ('succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "plan_uploads" ADD CONSTRAINT "plan_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_uploads" ADD CONSTRAINT "plan_uploads_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_runs" ADD CONSTRAINT "recognition_runs_upload_id_plan_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."plan_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_runs" ADD CONSTRAINT "recognition_runs_confirmed_node_id_design_nodes_id_fk" FOREIGN KEY ("confirmed_node_id") REFERENCES "public"."design_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_uploads_project_idx" ON "plan_uploads" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "recognition_runs_upload_idx" ON "recognition_runs" USING btree ("upload_id","created_at");