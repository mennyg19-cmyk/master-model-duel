-- P8: typical packed weight per package type (bin-packing fallback).
ALTER TABLE "package_types" ADD COLUMN "weightGrams" INTEGER NOT NULL DEFAULT 0;
