-- White-model nodes were named "白模确认" (with "（n）" or " 副本n" suffixes); they are now "白模".
UPDATE "design_nodes" SET "name" = '白模' || substr("name", 5) WHERE "kind" = 'white' AND "name" LIKE '白模确认%';
