import { Injectable, Logger } from '@nestjs/common';
import { UsersService, type CreatedUser } from '../auth/users.service';
import type { SetupDto } from './dto/setup.dto';

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(private readonly users: UsersService) {}

  async status(): Promise<{ setupRequired: boolean }> {
    return { setupRequired: !(await this.users.hasAnyUser()) };
  }

  async setup(dto: SetupDto): Promise<CreatedUser> {
    const user = await this.users.createFirstUser(dto);
    this.logger.log(
      `First-run setup completed: created user ${user.id} (${user.email})`,
    );
    return user;
  }
}
