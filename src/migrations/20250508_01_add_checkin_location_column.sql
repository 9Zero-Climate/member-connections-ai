-- Add checkin location column - location where the member is currently checked in, or null if checked out
ALTER TABLE members
ADD COLUMN IF NOT EXISTS checkin_location TEXT NULL;