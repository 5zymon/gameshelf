import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateGameDto } from './dto/create-game.dto';
import { EnrichGameDto } from './dto/enrich-game.dto';
import { EnrichGameResponseModel } from './dto/enrich-game-response.model';
import { GameIdParamDto } from './dto/game-id-param.dto';
import { GameSearchResponseModel } from './dto/game-search-response.model';
import { ListGamesQueryDto } from './dto/list-games-query.dto';
import { SearchGamesQueryDto } from './dto/search-games-query.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import {
  GameDetailModel,
  ListGamesResponseModel,
} from './dto/game-response.model';
import { GamesService } from './games.service';

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  @ApiOperation({
    summary: 'List games (paginated, filterable, searchable, sortable)',
    description:
      'Filters combine with AND. `q` is a case-insensitive partial title match (LIKE). ' +
      'Sorting is deterministic (id tiebreaker); `sort=year` puts unknown years last. ' +
      '`meta.total` reflects the filtered set. `filters` returns available platform/edition values.',
  })
  @ApiOkResponse({ type: ListGamesResponseModel })
  @ApiBadRequestResponse({
    description: 'Invalid page/limit/filter/sort values',
  })
  list(@Query() query: ListGamesQueryDto): Promise<ListGamesResponseModel> {
    return this.gamesService.list(query);
  }

  @Get('search')
  @ApiOperation({
    summary:
      'Search the external game database for manual add (debounce-protected)',
  })
  @ApiOkResponse({ type: GameSearchResponseModel })
  @ApiServiceUnavailableResponse({
    description: 'Game database unavailable or not configured',
  })
  search(
    @Query() query: SearchGamesQueryDto,
  ): Promise<GameSearchResponseModel> {
    return this.gamesService.search(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single game by id' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: GameDetailModel })
  @ApiNotFoundResponse({ description: 'Game not found' })
  findOne(@Param() params: GameIdParamDto): Promise<GameDetailModel> {
    return this.gamesService.findOne(params.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a game (manual entry)' })
  @ApiCreatedResponse({ type: GameDetailModel })
  @ApiBadRequestResponse({
    description: 'Validation error or unknown platformId',
  })
  @ApiConflictResponse({
    description:
      'A game with the same identity is already in the catalog (`code=GAME_ALREADY_IN_CATALOG`; the existing game is in the body). A picked `candidate` that no longer appears in a fresh search also returns 409.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Game database unavailable or not configured',
  })
  create(@Body() dto: CreateGameDto): Promise<GameDetailModel> {
    return this.gamesService.create(dto);
  }

  @Post(':id/copies')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Increment a game copy count (add another physical copy)',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: GameDetailModel })
  @ApiNotFoundResponse({ description: 'Game not found' })
  addCopy(@Param() params: GameIdParamDto): Promise<GameDetailModel> {
    return this.gamesService.addCopy(params.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a game' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: GameDetailModel })
  @ApiBadRequestResponse({
    description: 'Validation error or unknown platformId',
  })
  @ApiNotFoundResponse({ description: 'Game not found' })
  update(
    @Param() params: GameIdParamDto,
    @Body() dto: UpdateGameDto,
  ): Promise<GameDetailModel> {
    return this.gamesService.update(params.id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a game' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Game deleted' })
  @ApiNotFoundResponse({ description: 'Game not found' })
  remove(@Param() params: GameIdParamDto): Promise<void> {
    return this.gamesService.remove(params.id);
  }

  @Post(':id/enrich')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-enrich a game from its current (corrected) title',
    description:
      'Search (empty body) returns a ranked candidate list, best first, up to 10. Apply ({candidate:{source,externalId}}) re-runs the search and merges any listed candidate in place.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: EnrichGameResponseModel })
  @ApiConflictResponse({
    description: 'The selected candidate is no longer available',
  })
  @ApiServiceUnavailableResponse({
    description: 'The game database is temporarily unavailable',
  })
  @ApiNotFoundResponse({ description: 'Game not found' })
  enrich(
    @Param() params: GameIdParamDto,
    @Body() dto: EnrichGameDto,
  ): Promise<EnrichGameResponseModel> {
    return this.gamesService.enrich(params.id, dto);
  }
}
