import { ApiProperty } from '@nestjs/swagger';

export class AuthUserModel {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'player@example.com' })
  email!: string;

  @ApiProperty({ enum: ['pl', 'en'], example: 'pl' })
  language!: string;

  @ApiProperty({ example: '2026-10-05T12:00:00.000Z' })
  createdAt!: Date;
}

export class LoginResponseModel {
  @ApiProperty({ type: AuthUserModel })
  user!: AuthUserModel;
}
