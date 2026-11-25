ALTER TABLE "project_drafts" DROP CONSTRAINT "project_drafts_pkey";--> statement-breakpoint
ALTER TABLE "project_drafts" ADD CONSTRAINT "project_drafts_project_id_base_node_id_pk" PRIMARY KEY("project_id","base_node_id");
