import { PipeTransform, Injectable, BadRequestException } from "@nestjs/common";
import { Types } from "mongoose";

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    // EVT-18: Don't reflect user input in error message (potential XSS in logs/UIs)
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException("ID inválido");
    }
    return value;
  }
}
