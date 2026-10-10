ALTER TABLE "assets" ADD COLUMN "category" text DEFAULT '非标陈列' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "product_image_file_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "product_image_match" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "plan_symbol_file_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_product_image_file_id_stored_files_id_fk" FOREIGN KEY ("product_image_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_plan_symbol_file_id_stored_files_id_fk" FOREIGN KEY ("plan_symbol_file_id") REFERENCES "public"."stored_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_known" CHECK ("assets"."category" IN ('软装道具', '信息化物料', '品牌标识', '非标陈列', '环境设施'));--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_image_match_known" CHECK ("assets"."product_image_match" IS NULL OR "assets"."product_image_match" IN ('exact', 'approximate'));