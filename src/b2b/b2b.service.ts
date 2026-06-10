import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { B2bContactDto } from "./dto/b2b-contact.dto";
import { B2bContact, B2bContactDocument } from "./schemas/b2b-contact.schema";

@Injectable()
export class B2bService {
  private readonly logger = new Logger(B2bService.name);

  constructor(
    @InjectModel(B2bContact.name)
    private b2bContactModel: Model<B2bContactDocument>,
  ) {}

  async createContact(dto: B2bContactDto): Promise<B2bContact> {
    const contact = new this.b2bContactModel(dto);
    const saved = await contact.save();
    this.logger.log(`B2B contact received: ${dto.companyName} (${dto.email})`);
    return saved;
  }
}
