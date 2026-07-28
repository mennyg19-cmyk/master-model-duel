-- AddForeignKey: uploader ids gain referential integrity; deleting a staff
-- account nulls the uploader on their uploads instead of dangling.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
