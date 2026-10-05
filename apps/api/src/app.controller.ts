import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getRoot(): { name: string; status: string } {
    return this.appService.getStatus();
  }

  @Public()
  @Get('health')
  getHealth(): { status: string } {
    return this.appService.getHealth();
  }
}
