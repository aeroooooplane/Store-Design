CREATE TABLE "display_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"source_sha256" text NOT NULL,
	"rules" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "display_rule_sets_source_unique" UNIQUE("source_sha256")
);
--> statement-breakpoint
CREATE INDEX "display_rule_sets_imported_idx" ON "display_rule_sets" USING btree ("imported_at");