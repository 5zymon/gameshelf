import { ApiProperty } from '@nestjs/swagger';

import { UUID_V7_EXAMPLE } from '../../common/uuid-v7';

export class AuthUserModel {
  @ApiProperty({ format: 'uuid', example: UUID_V7_EXAMPLE })
  id!: string;

  @ApiProperty({ example: 'player@example.com' })
  email!: string;

  @ApiProperty({ enum: ['pl', 'en'], example: 'en' })
  language!: string;

  @ApiProperty({ enum: ['light', 'dark', 'system'], example: 'system' })
  theme!: string;

  @ApiProperty({ example: '2026-10-05T12:00:00.000Z' })
  createdAt!: Date;
}

export class LoginResponseModel {
  @ApiProperty({ type: AuthUserModel })
  user!: AuthUserModel;
}
