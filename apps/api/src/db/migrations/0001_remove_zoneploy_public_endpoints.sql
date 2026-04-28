UPDATE "add_on_bindings"
SET "status" = 'disabled',
    "deleted_at" = now(),
    "delete_reason" = 'addon_removed',
    "updated_at" = now()
WHERE "server_add_on_installation_id" IN (
  SELECT "server_add_on_installations"."id"
  FROM "server_add_on_installations"
  INNER JOIN "add_ons" ON "server_add_on_installations"."add_on_id" = "add_ons"."id"
  WHERE "add_ons"."slug" = 'custom-domains-edge'
    AND "server_add_on_installations"."deleted_at" IS NULL
)
  AND "deleted_at" IS NULL;
--> statement-breakpoint
UPDATE "server_add_on_installations"
SET "status" = 'disabled',
    "deleted_at" = now(),
    "delete_reason" = 'addon_removed',
    "updated_at" = now()
WHERE "add_on_id" IN (
  SELECT "id" FROM "add_ons" WHERE "slug" = 'custom-domains-edge'
)
  AND "deleted_at" IS NULL;
--> statement-breakpoint
UPDATE "add_ons"
SET "is_active" = false
WHERE "slug" = 'custom-domains-edge';
--> statement-breakpoint
DROP TABLE IF EXISTS "zoneploy_public_endpoints";
