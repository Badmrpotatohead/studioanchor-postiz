import { Injectable } from '@nestjs/common';
import { DeliveryStopRepository } from './delivery.stop.repository';
import { DeliveryStopDto } from '@gitroom/nestjs-libraries/dtos/posts/delivery.stop.dto';

@Injectable()
export class DeliveryStopService {
  constructor(private _repository: DeliveryStopRepository) {}
  stop(orgId: string, id: string, input: DeliveryStopDto) {
    return this._repository.stop(orgId, id, input);
  }
  receipt(orgId: string, id: string, requestId: string) {
    return this._repository.receipt(orgId, id, requestId);
  }
  claim(orgId: string, id: string, scheduledAt: string, runId: string) {
    return this._repository.claim(orgId, id, scheduledAt, runId);
  }
}
