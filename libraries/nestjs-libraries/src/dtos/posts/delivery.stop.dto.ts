import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class StopImageDto {
  @IsString() @MaxLength(200) id: string;
  @IsString() @MaxLength(2048) path: string;
  @IsString() @MaxLength(2000) alt: string;
}
export class DeliveryStopDto {
  @Matches(/^[a-f0-9]{64}$/) requestId: string;
  @Matches(/^[a-f0-9]{64}$/) binding: string;
  @IsString() @MaxLength(200) integrationId: string;
  @IsString() @MaxLength(10000) content: string;
  @IsISO8601({ strict: true }) scheduledAt: string;
  @IsArray()
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => StopImageDto)
  images: StopImageDto[];
}
