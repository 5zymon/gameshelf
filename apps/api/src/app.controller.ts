import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot(): { name: string; status: string } {
    return this.appService.getStatus();
  }

  @Get('health')
  getHealth(): { status: string } {
    return this.appService.getHealth();
  }
}
