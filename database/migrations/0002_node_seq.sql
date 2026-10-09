DROP INDEX "design_nodes_project_idx";--> statement-breakpoint
ALTER TABLE "design_nodes" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "design_nodes_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "design_nodes_project_idx" ON "design_nodes" USING btree ("project_id","seq");