import { PipeTransform, Injectable, BadRequestException } from "@nestjs/common";
import { Types } from "mongoose";

const OBJECT_ID_HEX_REGEX = /^[a-fA-F0-9]{24}$/;

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    // EVT-18: Don't reflect user input in error message (potential XSS in logs/UIs)
    // Require exact 24-hex ObjectId format (Types.ObjectId.isValid alone accepts any 12-char string).
    if (
      !value ||
      typeof value !== "string" ||
      !OBJECT_ID_HEX_REGEX.test(value) ||
      !Types.ObjectId.isValid(value)
    ) {
      throw new BadRequestException("ID inválido");
    }
    return value;
  }
}
