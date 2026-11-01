import { Body, ConflictException, Controller, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { AuthUser, CurrentUser, NoTenant, Public } from '../../common/auth.decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { DB, Db } from '../../db/client';
import { complexes, memberships, users } from '../../db/schema';
import { AuthService } from './auth.service';

const password = z
  .string()
  .min(8, 'Mínimo 8 caracteres')
  .max(128)
  .regex(/[A-Za-z]/, 'Debe incluir letras')
  .regex(/\d/, 'Debe incluir números');

const registerSchema = z.object({
  fullName: z.string().min(2).max(150),
  email: z.string().email(),
  password,
  phone: z.string().max(30).optional(),
  complexName: z.string().min(2).max(150),
  complexType: z.enum(['RESIDENTIAL', 'RECREATIONAL', 'MIXED']).default('RESIDENTIAL'),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(10) });
const updateMeSchema = z.object({
  fullName: z.string().min(2).max(150).optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().optional(),
});
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  // ─── Crear cuenta / sesión ───
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/register')
  register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.auth.register(body);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('auth/login')
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @HttpCode(200)
  @Post('auth/refresh')
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @NoTenant()
  @HttpCode(204)
  @Post('auth/logout-all')
  async logoutAll(@CurrentUser() u: AuthUser) {
    await this.auth.logoutAll(u.id);
  }

  // ─── Gestión de cuenta ───
  @NoTenant()
  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const [user] = await this.db
      .select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, u.id));
    const complexList = await this.db
      .select({ id: complexes.id, name: complexes.name, type: complexes.type, role: memberships.role })
      .from(memberships)
      .innerJoin(complexes, eq(complexes.id, memberships.complexId))
      .where(eq(memberships.userId, u.id));
    return { ...user, complexes: complexList };
  }

  @NoTenant()
  @Patch('me')
  async updateMe(@CurrentUser() u: AuthUser, @Body(new ZodPipe(updateMeSchema)) body: z.infer<typeof updateMeSchema>) {
    const patch = { ...body, email: body.email?.toLowerCase().trim() };
    if (patch.email) {
      const [taken] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.email, patch.email), ne(users.id, u.id)));
      if (taken) throw new ConflictException('Ese correo ya está en uso');
    }
    await this.db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, u.id));
    return this.me(u);
  }

  @NoTenant()
  @HttpCode(200)
  @Post('me/password')
  changePassword(@CurrentUser() u: AuthUser, @Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>) {
    return this.auth.changePassword(u.id, body.currentPassword, body.newPassword);
  }
}
