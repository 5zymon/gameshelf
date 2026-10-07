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
import { ListGamesQueryDto } from './dto/list-games-query.dto';
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
  create(@Body() dto: CreateGameDto): Promise<GameDetailModel> {
    return this.gamesService.create(dto);
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
