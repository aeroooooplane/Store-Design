ALTER TABLE "assets" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "retired" boolean DEFAULT false NOT NULL;