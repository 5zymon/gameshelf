import { PartialType } from '@nestjs/swagger';
import { CreateGameDto } from './create-game.dto';

/**
 * Partial update: every field optional. An explicit `null` clears an optional
 * field (class-validator `@IsOptional` lets `null` through); a missing key
 * leaves the field untouched.
 */
export class UpdateGameDto extends PartialType(CreateGameDto) {}
