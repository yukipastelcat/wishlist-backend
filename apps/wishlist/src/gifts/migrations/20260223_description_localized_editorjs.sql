-- Converts legacy gifts.descriptionLocalized values from locale->string
-- into locale->Editor.js document. Safe to run multiple times.

UPDATE gifts g
SET "descriptionLocalized" = migrated.new_value
FROM (
  SELECT
    id,
    jsonb_object_agg(locale_key, normalized_value) AS new_value
  FROM (
    SELECT
      g2.id,
      e.key AS locale_key,
      CASE
        WHEN jsonb_typeof(e.value) = 'string' THEN
          jsonb_build_object(
            'version', '2.29.1',
            'blocks', jsonb_build_array(
              jsonb_build_object(
                'type', 'paragraph',
                'data', jsonb_build_object('text', btrim(e.value #>> '{}'))
              )
            )
          )
        WHEN jsonb_typeof(e.value) = 'object' AND (e.value ? 'blocks') THEN
          e.value
        ELSE NULL
      END AS normalized_value
    FROM gifts g2
    CROSS JOIN LATERAL jsonb_each(g2."descriptionLocalized") AS e
    WHERE g2."descriptionLocalized" IS NOT NULL
  ) expanded
  WHERE normalized_value IS NOT NULL
  GROUP BY id
) migrated
WHERE g.id = migrated.id;
