import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

/**
 * Body for `POST /api/profile/identity/verify`.
 *
 * `expeditionDate` is only required for foreigner documents
 * (Cédula de Extranjería, PPT, PEP) whose Verifik routes demand the
 * document issue date in `DD/MM/YYYY`. The client sends an ISO
 * calendar date (YYYY-MM-DD, from `<input type="date">`) and the
 * service converts it — raw DD/MM/YYYY strings are rejected so the
 * upstream never receives an ambiguous format.
 */
export class VerifyIdentityDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "expeditionDate debe ser una fecha valida YYYY-MM-DD",
  })
  expeditionDate?: string;
}
