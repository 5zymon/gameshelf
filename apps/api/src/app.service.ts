import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus(): { name: string; status: string } {
    return { name: 'GameShelf API', status: 'ok' };
  }

  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
