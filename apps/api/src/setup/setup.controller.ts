import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { SetupDto } from './dto/setup.dto';
import { SetupResponseModel, SetupStatusModel } from './dto/setup.model';
import { SetupService } from './setup.service';

@ApiTags('setup')
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @Get('status')
  @ApiOperation({
    summary:
      'Report whether first-run setup is still required (users table empty)',
  })
  @ApiOkResponse({ type: SetupStatusModel })
  status(): Promise<SetupStatusModel> {
    return this.setup.status();
  }

  @Public()
  @Post()
  @ApiOperation({
    summary:
      'Create the first account; permanently disabled once a user exists',
  })
  @ApiCreatedResponse({ type: SetupResponseModel })
  @ApiBadRequestResponse({
    description: 'Validation error, blank email, or empty password',
  })
  @ApiConflictResponse({ description: 'Setup has already been completed' })
  async create(@Body() dto: SetupDto): Promise<SetupResponseModel> {
    const user = await this.setup.setup(dto);
    return { user };
  }
}
