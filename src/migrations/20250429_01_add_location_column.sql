-- Add location column (to ultimately replace location_tags)
ALTER TABLE members
ADD COLUMN IF NOT EXISTS location TEXT NULL;