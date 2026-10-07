import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CoverCacheService } from './cover-cache.service';

/**
 * Serves locally cached covers as same-origin assets. The route is behind the
 * global `SessionGuard` (like every non-`@Public()` route), so a browser `<img>`
 * on an authenticated page sends the first-party session cookie automatically.
 */
@Controller('covers')
export class CoversController {
  constructor(private readonly cache: CoverCacheService) {}

  @Get(':file')
  async serve(
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.cache.read(file);
    if (asset === null) {
      res.status(404).send();
      return;
    }
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Session-gated resource: only a private (browser) cache may reuse it.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(asset.buffer);
  }
}
