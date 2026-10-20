/**
 * Declares that `GET /stats` takes no query params. The global
 * `ValidationPipe` only runs for a bound DTO, so without it unknown params
 * would pass silently instead of failing with 400.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- intentionally empty: forbids all query params
export class StatsQueryDto {}
