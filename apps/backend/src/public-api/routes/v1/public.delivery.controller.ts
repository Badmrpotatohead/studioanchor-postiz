import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { DeliveryStopDto } from '@gitroom/nestjs-libraries/dtos/posts/delivery.stop.dto';
import { DeliveryStopService } from '@gitroom/nestjs-libraries/database/prisma/posts/delivery.stop.service';

@ApiTags('Public API')
@Controller('/public/v1')
export class PublicDeliveryController {
  constructor(private _deliveryStopService: DeliveryStopService) {}

  @Get('/delivery-control')
  deliveryControl() {
    return {
      protocol:
        process.env.POSTIZ_DISPATCH_FENCE_ENABLED === 'true'
          ? 'dispatch-fence-v1'
          : null,
    };
  }

  @Post('/posts/:id/stop')
  stopDelivery(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() input: DeliveryStopDto
  ) {
    return this._deliveryStopService.stop(org.id, id, input);
  }

  @Get('/posts/:id/stop/:requestId')
  stopReceipt(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('requestId') requestId: string
  ) {
    return this._deliveryStopService.receipt(org.id, id, requestId);
  }
}
