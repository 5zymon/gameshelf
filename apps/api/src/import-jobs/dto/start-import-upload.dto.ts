import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { MAX_UPLOAD_FILES } from '../upload.options';

export class StartImportUploadDto {
  @ApiPropertyOptional({
    description:
      'Optional per-photo declared item count, index-aligned with `files`. ' +
      'Repeat the field once per photo (an empty value leaves that photo ' +
      'undeclared); omit entirely to leave every photo undeclared.',
    type: [String],
    example: ['12', '', '3'],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null
      ? undefined
      : Array.isArray(value)
        ? value
        : [value],
  )
  @IsArray()
  @ArrayMaxSize(MAX_UPLOAD_FILES)
  @IsString({ each: true })
  declaredCounts?: string[];

  /**
   * Documentation-only multipart file part (files arrive via req.files).
   *
   * `@IsOptional()` is required, not cosmetic: under ES2022's
   * `useDefineForClassFields` the bare field exists on the instance as
   * `undefined`, so the global pipe's `forbidNonWhitelisted` would reject
   * every upload unless the property carries a validation decorator.
   */
  @IsOptional()
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    description: 'JPEG/PNG/WebP photos, max 10 files, 15 MB each',
  })
  files?: string[];
}
