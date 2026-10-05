import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SetupDto {
  @ApiProperty({ example: 'player@example.com', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple', maxLength: 1024 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}
