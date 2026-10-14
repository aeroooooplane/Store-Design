CREATE TABLE "display_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"market" "market" DEFAULT 'domestic' NOT NULL,
	"si_style" "si_style" DEFAULT 'SI2.0' NOT NULL,
	"plan_file_id" uuid,
	"plan_width" integer,
	"plan_height" integer,
	"plan_page" integer,
	"render_file_id" uuid,
	"render_width" integer,
	"render_height" integer,
	"render_page" integer,
	"state" jsonb NOT NULL,
	"exports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "node_displays" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"edits" jsonb NOT NULL,
	"exports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "display_ppt_file_id" uuid;--> statement-breakpoint
ALTER TABLE "display_tasks" ADD CONSTRAINT "display_tasks_plan_file_id_stored_files_id_fk" FOREIGN KEY ("plan_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_tasks" ADD CONSTRAINT "display_tasks_render_file_id_stored_files_id_fk" FOREIGN KEY ("render_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_displays" ADD CONSTRAINT "node_displays_node_id_design_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."design_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "display_tasks_updated_idx" ON "display_tasks" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_display_ppt_file_id_stored_files_id_fk" FOREIGN KEY ("display_ppt_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;