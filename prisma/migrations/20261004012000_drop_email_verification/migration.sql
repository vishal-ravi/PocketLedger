-- Email verification is gone: no verify mail, no banner, no column.
DELETE FROM "AuthToken" WHERE "type" = 'VERIFY_EMAIL';

ALTER TABLE "User" DROP COLUMN "emailVerifiedAt";

ALTER TABLE "AuthToken" ALTER COLUMN "type" TYPE TEXT;
DROP TYPE "AuthTokenType";
CREATE TYPE "AuthTokenType" AS ENUM ('RESET_PASSWORD');
ALTER TABLE "AuthToken" ALTER COLUMN "type" TYPE "AuthTokenType" USING "type"::"AuthTokenType";
