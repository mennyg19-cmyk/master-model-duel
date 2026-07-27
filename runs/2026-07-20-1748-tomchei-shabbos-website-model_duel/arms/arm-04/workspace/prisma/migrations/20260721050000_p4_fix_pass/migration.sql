-- P4 fix pass.
--
-- 1) M4: guest drafts are season-scoped, so guest token uniqueness must be
--    too. The old global unique made a stale 14-day guest cookie 500 the
--    builder when the same browser opened a different season.
DROP INDEX "OrderDraft_guestTokenHash_key";
CREATE UNIQUE INDEX "OrderDraft_seasonId_guestTokenHash_key" ON "OrderDraft"("seasonId", "guestTokenHash");

-- 2) M3: repair the p4_builder_accounts normalizedKey backfill. That backfill
--    lowercased and collapsed punctuation but did NOT apply the street-suffix
--    aliases (street->st, avenue->ave, ...) that lib/addresses/normalize.ts
--    applies, so re-saving a pre-existing row would produce a different key
--    and duplicate the entry instead of deduping (UR-014).
--    This recomputes every key with the exact app algorithm: per part,
--    lowercase -> non-alphanumerics to spaces -> split on whitespace -> drop
--    empties -> suffix-alias each word -> join with single spaces; parts
--    joined with '|', state lowercased raw, zip raw.
CREATE FUNCTION pg_temp.p4_norm_part(part text) RETURNS text
LANGUAGE sql AS $fn$
  SELECT COALESCE((
    SELECT string_agg(
      CASE t.word
        WHEN 'street' THEN 'st'
        WHEN 'avenue' THEN 'ave'
        WHEN 'av' THEN 'ave'
        WHEN 'road' THEN 'rd'
        WHEN 'drive' THEN 'dr'
        WHEN 'lane' THEN 'ln'
        WHEN 'court' THEN 'ct'
        WHEN 'boulevard' THEN 'blvd'
        WHEN 'place' THEN 'pl'
        WHEN 'terrace' THEN 'ter'
        WHEN 'circle' THEN 'cir'
        WHEN 'highway' THEN 'hwy'
        ELSE t.word
      END, ' ' ORDER BY t.ord)
    FROM regexp_split_to_table(regexp_replace(lower(part), '[^a-z0-9 ]+', ' ', 'g'), '\s+')
      WITH ORDINALITY AS t(word, ord)
    WHERE t.word <> ''
  ), '');
$fn$;

-- Rows whose recomputed key would collide with another row of the same
-- customer (i.e. rows that were ALREADY duplicates of the same place) keep
-- their old key so the unique constraint holds; they were duplicates before
-- this migration and merging rows is a data decision, not a schema repair.
WITH recomputed AS (
  SELECT id, "customerId",
         pg_temp.p4_norm_part("recipient") || '|' ||
         pg_temp.p4_norm_part("line1") || '|' ||
         pg_temp.p4_norm_part(coalesce("line2", '')) || '|' ||
         pg_temp.p4_norm_part("city") || '|' ||
         lower("state") || '|' || "zip" AS key
  FROM "CustomerAddress"
)
UPDATE "CustomerAddress" a
SET "normalizedKey" = r.key
FROM recomputed r
WHERE a.id = r.id
  AND a."normalizedKey" IS DISTINCT FROM r.key
  AND NOT EXISTS (
    SELECT 1 FROM recomputed other
    WHERE other."customerId" = r."customerId" AND other.id <> r.id AND other.key = r.key
  )
  AND NOT EXISTS (
    SELECT 1 FROM "CustomerAddress" cur
    WHERE cur."customerId" = r."customerId" AND cur.id <> r.id AND cur."normalizedKey" = r.key
  );

DROP FUNCTION pg_temp.p4_norm_part(text);
