-- The white-model stage is now the 3D effect stage: nodes named "白模" (with "（n）", " 副本n" or
-- " · SI2.0" suffixes) become "三维效果".
UPDATE "design_nodes" SET "name" = '三维效果' || substr("name", 3) WHERE "kind" = 'white' AND "name" LIKE '白模%';
