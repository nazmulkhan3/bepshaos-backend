import { PartialType } from '@nestjs/swagger';
import { CreateBusinessDto } from './create-business.dto.js';

export class UpdateBusinessDto extends PartialType(CreateBusinessDto) {}
