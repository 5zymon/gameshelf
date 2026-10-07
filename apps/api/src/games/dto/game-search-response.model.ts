import { ApiProperty } from '@nestjs/swagger';
import { EnrichCandidateModel } from './enrich-game-response.model';

/** `GET /games/search` response: a ranked candidate list from the game database. */
export class GameSearchResponseModel {
  @ApiProperty({ type: [EnrichCandidateModel] })
  candidates!: EnrichCandidateModel[];
}
