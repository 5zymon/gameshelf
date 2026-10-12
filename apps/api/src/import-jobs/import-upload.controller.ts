import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { StartImportUploadResponseModel } from './dto/import-upload-response.model';
import { StartImportUploadDto } from './dto/start-import-upload.dto';
import { ImportUploadService } from './import-upload.service';
import { UploadErrorInterceptor } from './multer-error.interceptor';
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  UPLOAD_FIELD_NAME,
  imageFileFilter,
} from './upload.options';

@ApiTags('import')
@Controller('import')
export class ImportUploadController {
  constructor(private readonly uploads: ImportUploadService) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Upload photos for import (queued; processed in the background)',
    description:
      'multipart/form-data. Repeating `declaredCounts` is optional and index-aligned with `files`. ' +
      'Photos are written to ephemeral storage and one queued import job is created per photo.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: StartImportUploadDto })
  @ApiAcceptedResponse({ type: StartImportUploadResponseModel })
  @ApiBadRequestResponse({
    description:
      'No files, unsupported type, oversized file, or misaligned/invalid declaredCounts',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiServiceUnavailableResponse({
    description: 'Game recognition is not configured (no base URL or API key)',
  })
  @UseInterceptors(
    UploadErrorInterceptor,
    FilesInterceptor(UPLOAD_FIELD_NAME, MAX_UPLOAD_FILES, {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
        files: MAX_UPLOAD_FILES,
      },
      fileFilter: imageFileFilter,
    }),
  )
  upload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: StartImportUploadDto,
  ): Promise<StartImportUploadResponseModel> {
    return this.uploads.startUpload(files ?? [], dto.declaredCounts);
  }
}
