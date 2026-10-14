import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class RequestSavingsExtensionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10, {
    message:
      "El motivo de la solicitud de prórroga debe tener al menos 10 caracteres.",
  })
  reason!: string;
}

export class RequestSavingsRefundDto {
  @IsString()
  @IsNotEmpty()
  bankName!: string;

  @IsString()
  @IsIn(["ahorros", "corriente", "Ahorros", "Corriente"])
  accountType!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  accountNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  accountHolderName!: string;

  @IsString()
  @IsIn(["CC", "CE", "NIT", "PASAPORTE"])
  identificationType!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  identificationNumber!: string;
}

export class AppealSavingsRefundDto {
  @IsString()
  @IsNotEmpty()
  refundRequestId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(15, {
    message: "La sustentación de apelación debe tener al menos 15 caracteres.",
  })
  explanation!: string;
}

export class EscalateSavingsLegalDto {
  @IsString()
  @IsNotEmpty()
  refundRequestId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(20, {
    message:
      "El requerimiento formal ante el Comité Legal debe tener al menos 20 caracteres.",
  })
  statement!: string;
}

export class ReviewSavingsExtensionDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReviewSavingsRefundConsoleDto {
  @IsBoolean()
  approved!: boolean;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, {
    message:
      "Las notas u observaciones del Director de Membresías deben tener al menos 10 caracteres.",
  })
  notes!: string;
}

export class ReviewSavingsRefundFinanceDto {
  @IsBoolean()
  approved!: boolean;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, {
    message:
      "El concepto financiero de la Gerencia Financiera debe tener al menos 10 caracteres.",
  })
  notes!: string;

  @IsOptional()
  @IsString()
  radicadoDocument?: string;
}

export class ReviewSavingsLegalDto {
  @IsBoolean()
  approved!: boolean;

  @IsString()
  @IsNotEmpty()
  @MinLength(15, {
    message:
      "La resolución del Comité de Asuntos Legales debe contener debida motivación.",
  })
  notes!: string;

  @IsOptional()
  @IsString()
  committeeRadicado?: string;
}
