CREATE TYPE "public"."actor_kind" AS ENUM('visitor', 'user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('delivery', 'recognition', 'render_blender', 'ai_enhance');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('domestic', 'overseas');--> statement-breakpoint
CREATE TYPE "public"."node_kind" AS ENUM('space', 'plan', 'edit', 'white', 'render');--> statement-breakpoint
CREATE TYPE "public"."node_origin" AS ENUM('user', 'generator', 'agent', 'import', 'recognition');--> statement-breakpoint
CREATE TYPE "public"."plan_strategy" AS ENUM('max', 'area', 'min', 'case');--> statement-breakpoint
CREATE TYPE "public"."render_engine" AS ENUM('three', 'blender');--> statement-breakpoint
CREATE TYPE "public"."render_mode" AS ENUM('white', 'material');--> statement-breakpoint
CREATE TYPE "public"."shop_type" AS ENUM('side_hall', 'island', 'zone');--> statement-breakpoint
CREATE TYPE "public"."si_style" AS ENUM('SI1.0', 'SI2.0');--> statement-breakpoint
CREATE TABLE "design_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "node_kind" NOT NULL,
	"name" text NOT NULL,
	"space" jsonb,
	"layout" jsonb,
	"strategy" "plan_strategy",
	"si_style" "si_style",
	"origin" "node_origin" NOT NULL,
	"origin_ref" uuid,
	"imported_from" text,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_nodes_project_node_key" UNIQUE("project_id","id"),
	CONSTRAINT "design_nodes_payload_matches_kind" CHECK (("design_nodes"."kind" = 'space' AND "design_nodes"."space" IS NOT NULL)
        OR ("design_nodes"."kind" <> 'space' AND "design_nodes"."space" IS NULL AND "design_nodes"."layout" IS NOT NULL AND "design_nodes"."parent_id" IS NOT NULL)),
	CONSTRAINT "design_nodes_strategy_only_on_plan" CHECK ("design_nodes"."strategy" IS NULL OR "design_nodes"."kind" = 'plan'),
	CONSTRAINT "design_nodes_name_not_blank" CHECK (length(trim("design_nodes"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "node_cameras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"camera" jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_drafts" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"base_node_id" uuid NOT NULL,
	"layout" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"shop_type" "shop_type" NOT NULL,
	"market" "market" DEFAULT 'domestic' NOT NULL,
	"si_style" "si_style" DEFAULT 'SI1.0' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "projects_name_not_blank" CHECK (length(trim("projects"."name")) > 0),
	CONSTRAINT "projects_revision_positive" CHECK ("projects"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"project_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root" text NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_root_key" UNIQUE("root","storage_key"),
	CONSTRAINT "stored_files_root_known" CHECK ("stored_files"."root" IN ('storage', 'resource')),
	CONSTRAINT "stored_files_sha256_hex" CHECK ("stored_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "stored_files_bytes_non_negative" CHECK ("stored_files"."bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"folder_name" text NOT NULL,
	"full_pdf_file_id" uuid,
	"show_pdf_file_id" uuid,
	"zip_file_id" uuid,
	"archive_path" text,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"camera_id" uuid NOT NULL,
	"mode" "render_mode" NOT NULL,
	"engine" "render_engine" NOT NULL,
	"si_style" "si_style" NOT NULL,
	"market" "market" NOT NULL,
	"layout_signature" text NOT NULL,
	"camera_signature" text NOT NULL,
	"file_id" uuid NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renders_variant_key" UNIQUE("camera_id","mode","engine","si_style","market","layout_signature","camera_signature")
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_cny" numeric(10, 4) NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_purpose_known" CHECK ("ai_usage"."purpose" IN ('agent', 'recognition')),
	CONSTRAINT "ai_usage_cost_non_negative" CHECK ("ai_usage"."cost_cny" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"request_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_nodes" ADD CONSTRAINT "design_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_nodes" ADD CONSTRAINT "design_nodes_parent_same_project_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."design_nodes"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_cameras" ADD CONSTRAINT "node_cameras_node_id_design_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."design_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drafts" ADD CONSTRAINT "project_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_drafts" ADD CONSTRAINT "project_drafts_base_node_same_project_fk" FOREIGN KEY ("project_id","base_node_id") REFERENCES "public"."design_nodes"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_full_pdf_file_id_stored_files_id_fk" FOREIGN KEY ("full_pdf_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_show_pdf_file_id_stored_files_id_fk" FOREIGN KEY ("show_pdf_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_zip_file_id_stored_files_id_fk" FOREIGN KEY ("zip_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_node_same_project_fk" FOREIGN KEY ("project_id","node_id") REFERENCES "public"."design_nodes"("project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_node_id_design_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."design_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_camera_id_node_cameras_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."node_cameras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_nodes_project_idx" ON "design_nodes" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "design_nodes_parent_idx" ON "design_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "node_cameras_node_idx" ON "node_cameras" USING btree ("node_id","sort");--> statement-breakpoint
CREATE INDEX "projects_listing_idx" ON "projects" USING btree ("deleted_at","updated_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_project_idx" ON "jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deliveries_project_idx" ON "deliveries" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "renders_node_idx" ON "renders" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "ai_usage_day_idx" ON "ai_usage" USING btree ("day");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity","entity_id","created_at");