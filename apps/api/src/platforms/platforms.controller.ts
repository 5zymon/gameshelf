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
      'Rename a platform (slug is kept); optional canonical fields for the IGDB integration',
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

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a platform — refused with 409 while games reference it',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Platform deleted' })
  @ApiConflictResponse({
    description: 'Platform still has games — reassign or delete them first',
  })
  @ApiNotFoundResponse({ description: 'Platform not found' })
  remove(@Param() params: PlatformIdParamDto): Promise<void> {
    return this.platformsService.remove(params.id);
  }
}
