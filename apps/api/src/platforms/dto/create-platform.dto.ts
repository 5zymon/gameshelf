import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePlatformDto {
  @ApiProperty({
    description: 'Platform name (unique, case-insensitive; whitespace-trimmed)',
    example: 'PlayStation 5',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}
