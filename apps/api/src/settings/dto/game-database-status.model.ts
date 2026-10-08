import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const GAME_DATABASE_IDS = ['igdb', 'mobygames'] as const;
export type GameDatabaseId = (typeof GAME_DATABASE_IDS)[number];
export const GAME_DATABASE_STATES = [
  'configured',
  'missing',
  'rejected',
] as const;
export type GameDatabaseState = (typeof GAME_DATABASE_STATES)[number];

export class GameDatabaseStatusModel {
  @ApiProperty({ enum: [...GAME_DATABASE_IDS], example: 'igdb' })
  id!: GameDatabaseId;

  @ApiProperty({ example: 'IGDB' })
  label!: string;

  @ApiProperty({ enum: [...GAME_DATABASE_STATES], example: 'configured' })
  state!: GameDatabaseState;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Safe reason when rejected',
  })
  message!: string | null;
}
