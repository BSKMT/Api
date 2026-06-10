import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { B2bService } from "./b2b.service";
import { B2bContactDto } from "./dto/b2b-contact.dto";

@Controller("b2b")
export class B2bController {
  constructor(private readonly b2bService: B2bService) {}

  @Post("contact")
  @HttpCode(HttpStatus.CREATED)
  async submitContact(@Body() dto: B2bContactDto) {
    await this.b2bService.createContact(dto);
    return {
      message:
        "Propuesta recibida. Nuestro equipo te contactara en un maximo de 48 horas habiles.",
    };
  }
}
