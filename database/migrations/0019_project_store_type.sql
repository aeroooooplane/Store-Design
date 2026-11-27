CREATE TYPE "public"."store_type" AS ENUM('exclusive', 'camera_retailer', 'zone');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "store_type" "store_type";