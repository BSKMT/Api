import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
} from "@nestjs/common";
import { ContactService } from "./contact.service";
import { ContactDto } from "./dto/contact.dto";
import { Public } from "../common/decorators";

/**
 * ContactController - Endpoint publico del formulario de contacto.
 * Expuesto en /api/contact (sin autenticacion) para que la landing page
 * pueda enviar mensajes de contacto que se entregan por correo.
 */
@Controller("contact")
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  /**
   * Endpoint de verificacion ligera para confirmar que el canal de contacto
   * esta activo sin exponer detalles internos.
   */
  @Public()
  @Get("health")
  @HttpCode(HttpStatus.OK)
  health() {
    return { status: "ok" };
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(@Body() dto: ContactDto) {
    return this.contactService.handleContact(dto);
  }
}
