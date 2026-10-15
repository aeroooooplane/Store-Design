ALTER TABLE "assets" ADD COLUMN "market" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "other_market_glb_file_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_other_market_glb_file_id_stored_files_id_fk" FOREIGN KEY ("other_market_glb_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_market_known" CHECK ("assets"."market" IS NULL OR "assets"."market" IN ('domestic', 'overseas'));