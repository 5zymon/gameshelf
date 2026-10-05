-- CreateIndex
CREATE INDEX `games_edition_idx` ON `games`(`edition`);

-- CreateIndex
CREATE INDEX `games_release_year_idx` ON `games`(`release_year`);

-- CreateIndex
CREATE INDEX `games_publisher_idx` ON `games`(`publisher`);

-- CreateIndex
CREATE INDEX `games_genre_idx` ON `games`(`genre`);

-- CreateIndex
CREATE INDEX `games_player_count_idx` ON `games`(`player_count`);
