CREATE TYPE "public"."item_function" AS ENUM('island_table', 'unboxing_table', 'cashier', 'accessory_cabinet', 'side_cabinet', 'display_stand', 'screen', 'signage', 'seating', 'storage', 'other');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"standard_name" text NOT NULL,
	"variant" text NOT NULL,
	"material_category" text NOT NULL,
	"si_family" text NOT NULL,
	"function" "item_function" NOT NULL,
	"installation" text,
	"width" numeric(9, 3) NOT NULL,
	"depth" numeric(9, 3) NOT NULL,
	"height" numeric(9, 3) NOT NULL,
	"footprint_source" text NOT NULL,
	"front" text,
	"staff_side" text,
	"facing_confidence" text,
	"placeable" boolean NOT NULL,
	"judgment" text,
	"glb_file_id" uuid,
	"preview_file_id" uuid,
	"source_sha256" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_id_format" CHECK ("assets"."id" ~ '^asset-[0-9]+$'),
	CONSTRAINT "assets_installation_known" CHECK ("assets"."installation" IS NULL OR "assets"."installation" IN ('floor', 'wall')),
	CONSTRAINT "assets_footprint_source_known" CHECK ("assets"."footprint_source" IN ('glb', 'source')),
	CONSTRAINT "assets_front_known" CHECK ("assets"."front" IS NULL OR "assets"."front" IN ('+Z', '-Z', '+X', '-X', 'any')),
	CONSTRAINT "assets_dimensions_positive" CHECK ("assets"."width" > 0 AND "assets"."depth" > 0 AND "assets"."height" > 0),
	CONSTRAINT "assets_placeable_needs_glb" CHECK (NOT "assets"."placeable" OR "assets"."glb_file_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_glb_file_id_stored_files_id_fk" FOREIGN KEY ("glb_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_preview_file_id_stored_files_id_fk" FOREIGN KEY ("preview_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_function_idx" ON "assets" USING btree ("function","placeable");