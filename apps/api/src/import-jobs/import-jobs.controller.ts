import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { GameDetailModel } from '../games/dto/game-response.model';
import { DismissImportJobDto } from './dto/dismiss-import-job.dto';
import { DismissUnrecognizedItemDto } from './dto/dismiss-unrecognized-item.dto';
import { ImportBatchIdParamDto } from './dto/import-batch-id-param.dto';
import { ImportJobIdParamDto } from './dto/import-job-id-param.dto';
import {
  ImportBatchProgressModel,
  ImportJobDetailModel,
  ImportQueueStateModel,
  ListImportJobsResponseModel,
  UnrecognizedItemModel,
} from './dto/import-job-response.model';
import { ListImportJobsQueryDto } from './dto/list-import-jobs-query.dto';
import { PickUnrecognizedCandidateDto } from './dto/pick-unrecognized-candidate.dto';
import { UnrecognizedItemIdParamDto } from './dto/unrecognized-item-id-param.dto';
import { ImportJobsService } from './import-jobs.service';
import { UnrecognizedItemPickService } from './unrecognized-item-pick.service';

@ApiTags('import-jobs')
@Controller('import-jobs')
export class ImportJobsController {
  constructor(
    private readonly importJobsService: ImportJobsService,
    private readonly pickService: UnrecognizedItemPickService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List import runs with status and counts, newest first',
    description:
      'Pagination is deterministic (createdAt DESC, id DESC tiebreaker). ' +
      '`meta.total` reflects the filtered set.',
  })
  @ApiOkResponse({ type: ListImportJobsResponseModel })
  @ApiBadRequestResponse({ description: 'Invalid page/limit/status values' })
  list(
    @Query() query: ListImportJobsQueryDto,
  ): Promise<ListImportJobsResponseModel> {
    return this.importJobsService.list(query);
  }

  @Get('batches/:batchId')
  @ApiOperation({
    summary: 'Aggregate progress for one upload batch (X of Y photos)',
  })
  @ApiParam({ name: 'batchId', type: String })
  @ApiOkResponse({ type: ImportBatchProgressModel })
  @ApiNotFoundResponse({ description: 'Import batch not found' })
  getBatch(
    @Param() params: ImportBatchIdParamDto,
  ): Promise<ImportBatchProgressModel> {
    return this.importJobsService.getBatchProgress(params.batchId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single import run with its unrecognized items (full trace)',
    description:
      'Includes dismissed items — the trace outlives dismissal (spec §4.2.5).',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: ImportJobDetailModel })
  @ApiNotFoundResponse({ description: 'Import job not found' })
  findOne(@Param() params: ImportJobIdParamDto): Promise<ImportJobDetailModel> {
    return this.importJobsService.findOne(params.id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Retry a failed import: re-runs only unresolved titles',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiAcceptedResponse({ type: ImportJobDetailModel })
  @ApiNotFoundResponse({ description: 'Import job not found' })
  @ApiConflictResponse({
    description: 'Only failed jobs with a stored photo can be retried',
  })
  retry(@Param() params: ImportJobIdParamDto): Promise<ImportJobDetailModel> {
    return this.importJobsService.retryJob(params.id);
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume the paused photo-import queue',
    description:
      'Clears the stored pause reason. Idempotent: a running queue stays running.',
  })
  @ApiOkResponse({ type: ImportQueueStateModel })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  resume(): Promise<ImportQueueStateModel> {
    return this.importJobsService.resumeQueue();
  }

  @Get(':id/unrecognized')
  @ApiOperation({
    summary: 'Flagged items awaiting review (non-dismissed only)',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: [UnrecognizedItemModel] })
  @ApiNotFoundResponse({ description: 'Import job not found' })
  listUnrecognized(
    @Param() params: ImportJobIdParamDto,
  ): Promise<UnrecognizedItemModel[]> {
    return this.importJobsService.listUnrecognized(params.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Dismiss a needs-attention/failed job (body: {"status":"dismissed"})',
    description:
      'Idempotent: dismissing an already-dismissed job is a 200 no-op. ' +
      'Dismissal is sticky — no endpoint transitions it back.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: ImportJobDetailModel })
  @ApiBadRequestResponse({
    description: "Validation error (only status 'dismissed' is accepted)",
  })
  @ApiNotFoundResponse({ description: 'Import job not found' })
  @ApiConflictResponse({
    description: 'Job is not needs-attention or failed',
  })
  dismiss(
    @Param() params: ImportJobIdParamDto,
    // Validated by the global pipe (only `{"status":"dismissed"}` passes);
    // the value itself needs no handling, hence the unused-arg prefix.
    @Body() _dto: DismissImportJobDto,
  ): Promise<ImportJobDetailModel> {
    return this.importJobsService.dismissJob(params.id);
  }

  @Patch(':id/unrecognized/:itemId')
  @ApiOperation({
    summary: 'Dismiss/acknowledge a flagged item (body: {"dismissed":true})',
    description:
      'One-way: stamps dismissed_at; there is no un-dismiss. ' +
      'Idempotent: re-dismissing is a 200 no-op.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'itemId', type: Number })
  @ApiOkResponse({ type: UnrecognizedItemModel })
  @ApiBadRequestResponse({
    description: 'Validation error (dismissed must be true)',
  })
  @ApiNotFoundResponse({
    description: 'Import job or unrecognized item not found',
  })
  dismissUnrecognizedItem(
    @Param() params: UnrecognizedItemIdParamDto,
    @Body() dto: DismissUnrecognizedItemDto,
  ): Promise<UnrecognizedItemModel> {
    if (!dto.dismissed) {
      throw new BadRequestException(
        'Only dismissing is supported (dismissed must be true)',
      );
    }
    return this.importJobsService.dismissUnrecognizedItem(
      params.id,
      params.itemId,
    );
  }

  @Post(':id/unrecognized/:itemId/pick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resolve a flagged item by picking one of its tied catalog candidates',
    description:
      'Creates the game (platform via the photo, metadata via the catalog) and ' +
      'marks the item reviewed, like "Add manually". The picked candidate is ' +
      're-confirmed against a fresh catalog search before any game is written.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiParam({ name: 'itemId', type: Number })
  @ApiOkResponse({ type: GameDetailModel })
  @ApiBadRequestResponse({
    description:
      "The picked candidate is not one of the item's tied candidates",
  })
  @ApiNotFoundResponse({
    description: 'Import job or unrecognized item not found',
  })
  @ApiConflictResponse({
    description:
      'Item already reviewed, candidate no longer available, or no usable platform',
  })
  @ApiServiceUnavailableResponse({
    description: 'The catalog source is temporarily unavailable',
  })
  pick(
    @Param() params: UnrecognizedItemIdParamDto,
    @Body() dto: PickUnrecognizedCandidateDto,
  ): Promise<GameDetailModel> {
    return this.pickService.pick(params.id, params.itemId, dto);
  }
}
