import { ApiProperty } from '@nestjs/swagger';
import { AuthUserModel } from '../../auth/dto/auth-user.model';

export class SetupStatusModel {
  @ApiProperty({
    example: true,
    description: 'True until the first account exists',
  })
  setupRequired!: boolean;
}

export class SetupResponseModel {
  @ApiProperty({ type: AuthUserModel })
  user!: AuthUserModel;
}
