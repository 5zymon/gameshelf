import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'gameshelf:isPublic';

/** Opts a controller or route out of the global session guard. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
