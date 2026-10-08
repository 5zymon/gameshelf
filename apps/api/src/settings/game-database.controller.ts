import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GameDatabaseStatusModel } from './dto/game-database-status.model';
import { GameDatabaseStatusService } from './game-database-status.service';

/**
 * Game-database configuration status for the settings screen. Auth is the
 * global `SessionGuard` (no `@Public()`), same as `/settings/llm`.
 */
@ApiTags('settings')
@Controller('settings/game-databases')
export class GameDatabaseController {
  constructor(private readonly status: GameDatabaseStatusService) {}

  @Get()
  @ApiOperation({
    summary: 'Game-database configuration status (no secrets)',
  })
  @ApiOkResponse({ type: [GameDatabaseStatusModel] })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  list(): Promise<GameDatabaseStatusModel[]> {
    return this.status.list();
  }
}
