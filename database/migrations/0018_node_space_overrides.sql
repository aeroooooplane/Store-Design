ALTER TABLE "design_nodes" DROP CONSTRAINT "design_nodes_payload_matches_kind";--> statement-breakpoint
ALTER TABLE "design_nodes" ADD CONSTRAINT "design_nodes_payload_matches_kind" CHECK (("design_nodes"."kind" = 'space' AND "design_nodes"."space" IS NOT NULL)
        OR ("design_nodes"."kind" <> 'space' AND "design_nodes"."layout" IS NOT NULL AND "design_nodes"."parent_id" IS NOT NULL));