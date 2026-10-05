-- One-time dev bootstrap (docker-entrypoint-initdb.d — runs only on first
-- initialization of an empty data directory, as root, after the entrypoint
-- creates the gameshelf user).
CREATE DATABASE IF NOT EXISTS gameshelf_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON gameshelf_test.* TO 'gameshelf'@'%';
FLUSH PRIVILEGES;
