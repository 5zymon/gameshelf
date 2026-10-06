import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';
import { MAX_UPLOAD_FILE_SIZE_BYTES } from './upload.options';

const MAX_MB = MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024);

/**
 * Multer's `LIMIT_FILE_SIZE` surfaces as a 413 `PayloadTooLargeException`
 * (platform-express), but the upload contract asks for a 400. Applied as the
 * OUTER interceptor around `FilesInterceptor`, so it sees and remaps the
 * rejected file stream.
 */
@Injectable()
export class UploadErrorInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof PayloadTooLargeException) {
          return throwError(
            () =>
              new BadRequestException(
                `Each photo must be at most ${String(MAX_MB)} MB`,
              ),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
