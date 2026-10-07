import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CoverCacheService } from './cover-cache.service';
import { CoverPreviewService } from './cover-preview.service';
import { COVER_PREVIEW_CACHE_MAX_AGE_SECONDS } from './covers.options';

/**
 * Serves locally cached covers and thumbnails as same-origin assets. The routes
 * are behind the global `SessionGuard` (like every non-`@Public()` route), so a
 * browser `<img>` on an authenticated page sends the first-party session cookie
 * automatically. No route ever redirects to an external host.
 */
@Controller('covers')
export class CoversController {
  constructor(
    private readonly cache: CoverCacheService,
    private readonly preview: CoverPreviewService,
  ) {}

  /**
   * `GET /covers/thumbs/:file` — the locally generated thumbnail for a stored
   * cover `<file>` (`<hash>.<ext>`). Falls back to the full cover bytes when no
   * thumbnail could be generated (e.g. an undecodable legacy file).
   */
  @Get('thumbs/:file')
  async serveThumbnail(
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset =
      (await this.cache.readThumbnail(file)) ?? (await this.cache.read(file));
    if (asset === null) {
      res.status(404).send();
      return;
    }
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(asset.buffer);
  }

  /**
   * `GET /covers/preview?u=<b64url>&s=<hmac>&e=<epoch>` — server-side
   * passthrough for an unsaved candidate. The signed `u`/`s`/`e` triple is
   * verified (including expiry) before fetching, so this cannot be used as an
   * open proxy; the browser never learns the external host.
   */
  @Get('preview')
  async servePreview(
    @Query('u') u: string | undefined,
    @Query('s') s: string | undefined,
    @Query('e') e: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const url =
      typeof u === 'string' && typeof s === 'string'
        ? this.preview.resolve(u, s, typeof e === 'string' ? e : undefined)
        : null;
    const asset = url === null ? null : await this.preview.fetch(url);
    if (asset === null) {
      res.status(404).send();
      return;
    }
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Cache-Control',
      `private, max-age=${String(COVER_PREVIEW_CACHE_MAX_AGE_SECONDS)}`,
    );
    res.send(asset.buffer);
  }

  /** `GET /covers/:file` — the full stored cover. */
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
