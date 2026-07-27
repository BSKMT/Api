import {
  IsString,
  IsIn,
  IsInt,
  Min,
  MaxLength,
  IsOptional,
} from "class-validator";

export class UseCreditDto {
  @IsString()
  @IsIn(["membership", "services"])
  creditSource!: string;

  // M-18: @IsInt enforces whole-COP integers; previously floats
  // silently slipped through ($inc with a fractional usedAmount could
  // never reach exactly `credit.amount` — locking the credit
  // permanently).
  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  /**
   * M-18: idempotency key. If supplied, the service checks the
   * credit-transaction ledger for a prior entry with the same key:
   * if present, it returns the original outcome instead of
   * re-debiting. Format: arbitrary opaque token (≤ 100 chars).
   */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  idempotencyKey?: string;
}
