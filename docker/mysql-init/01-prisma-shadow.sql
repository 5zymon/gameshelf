-- One-time dev bootstrap (docker-entrypoint-initdb.d — runs only on first
-- initialization of an empty data directory, as root, after the entrypoint
-- creates the gameshelf user).
--
-- `prisma migrate dev` needs a shadow database, but the app user only has
-- privileges on `gameshelf`. Create a dedicated shadow database and grant
-- the app user access to it (Prisma docs recommend a dedicated shadow DB
-- over the deprecated wildcard grant on `prisma_migrate_shadow_db%`).
CREATE DATABASE IF NOT EXISTS gameshelf_shadow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON gameshelf_shadow.* TO 'gameshelf'@'%';
FLUSH PRIVILEGES;
