import { Injectable } from '@nestjs/common';
import { type IgdbHealth, IgdbClient } from './igdb.client';

@Injectable()
export class IgdbHealthService {
  constructor(private readonly igdb: IgdbClient) {}

  check(): Promise<IgdbHealth> {
    return this.igdb.checkHealth();
  }
}
