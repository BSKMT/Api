import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

const REQUIRED_PROFILE_SECTIONS = [
  'datos-personales',
  'contacto',
  'motocicleta',
  'salud-seguridad',
  'documentacion-legal',
  'membresia-ecosistema',
  'equipamiento',
  'experiencia-motera',
];

@Schema({
  timestamps: true,
  collection: 'users',
})
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: null })
  membershipLevel: string | null;

  @Prop({ default: 'user' })
  role: string;

  @Prop({ default: false })
  profileCompleted: boolean;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  refreshTokenHash?: string;

  @Prop({ type: Object, default: {} })
  profile: Record<string, Record<string, unknown>>;

  @Prop({ default: [] })
  completedSections: string[];
}

export const UserSchema = SchemaFactory.createForClass(User);

export { REQUIRED_PROFILE_SECTIONS };
