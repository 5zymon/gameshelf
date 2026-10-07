import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
  ApiTags,
} from '@nestjs/swagger';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { MergePlatformDto } from './dto/merge-platform.dto';
import { PlatformIdParamDto } from './dto/platform-id-param.dto';
import { PlatformModel } from './dto/platform-response.model';
import { UpdatePlatformDto } from './dto/update-platform.dto';
import { PlatformsService } from './platforms.service';

@ApiTags('platforms')
@Controller('platforms')
export class PlatformsController {
  constructor(private readonly platformsService: PlatformsService) {}

  @Get()
  @ApiOperation({
    summary: 'List platforms with a game count each (sorted by name)',
  })
  @ApiOkResponse({ type: [PlatformModel] })
  list(): Promise<PlatformModel[]> {
    return this.platformsService.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single platform by id' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: PlatformModel })
  @ApiNotFoundResponse({ description: 'Platform not found' })
  findOne(@Param() params: PlatformIdParamDto): Promise<PlatformModel> {
    return this.platformsService.findOne(params.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a platform (slug is generated)' })
  @ApiCreatedResponse({ type: PlatformModel })
  @ApiBadRequestResponse({
    description: 'Validation error or blank name',
  })
  @ApiConflictResponse({
    description: 'A platform with this name already exists',
  })
  create(@Body() dto: CreatePlatformDto): Promise<PlatformModel> {
    return this.platformsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Rename a platform (slug is kept; the old name becomes an alias); optional canonical fields for the IGDB integration; toggle hidden',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: PlatformModel })
  @ApiBadRequestResponse({
    description: 'Validation error or blank name',
  })
  @ApiConflictResponse({
    description: 'A platform with this name already exists',
  })
  @ApiNotFoundResponse({ description: 'Platform not found' })
  rename(
    @Param() params: PlatformIdParamDto,
    @Body() dto: UpdatePlatformDto,
  ): Promise<PlatformModel> {
    return this.platformsService.rename(params.id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Confirm an import-created platform (clears the added-by-import flag)',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: PlatformModel })
  @ApiNotFoundResponse({ description: 'Platform not found' })
  confirm(@Param() params: PlatformIdParamDto): Promise<PlatformModel> {
    return this.platformsService.confirm(params.id);
  }

  @Post(':id/merge')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Merge a platform into a target: move its games, keep its name as an alias, delete it',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ type: PlatformModel })
  @ApiBadRequestResponse({
    description: 'Cannot merge a platform into itself',
  })
  @ApiNotFoundResponse({ description: 'Source or target platform not found' })
  @ApiConflictResponse({
    description: 'A game referenced the source platform concurrently',
  })
  merge(
    @Param() params: PlatformIdParamDto,
    @Body() dto: MergePlatformDto,
  ): Promise<PlatformModel> {
    return this.platformsService.merge(params.id, dto.targetId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete a custom platform, or hide a reference platform; refused with 409 while games reference it',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Platform deleted or hidden' })
  @ApiConflictResponse({
    description: 'Platform still has games — reassign or delete them first',
  })
  @ApiNotFoundResponse({ description: 'Platform not found' })
  remove(@Param() params: PlatformIdParamDto): Promise<void> {
    return this.platformsService.remove(params.id);
  }
}
