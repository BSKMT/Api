import { IsString, IsOptional, MaxLength } from "class-validator";

export class AddWishlistDto {
  @IsString()
  productSlug: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  productName?: string;
}
