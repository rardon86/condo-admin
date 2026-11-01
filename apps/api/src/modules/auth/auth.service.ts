import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { DB, Db } from '../../db/client';
import { complexes, memberships, users } from '../../db/schema';
import { AuditService } from '../../common/audit.service';
import { LedgerService } from '../ledger/ledger.service';

const BCRYPT_ROUNDS = 12;

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  complexName: string;
  complexType: 'RESIDENTIAL' | 'RECREATIONAL' | 'MIXED';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  hash(password: string) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /** Crea usuario + complejo + membresía OWNER + catálogo de cuentas, de forma atómica. */
  async register(input: RegisterInput) {
    const email = input.email.toLowerCase().trim();
    const [exists] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new ConflictException('Ya existe una cuenta con ese correo');
    const passwordHash = await this.hash(input.password);

    const user = await this.db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email, passwordHash, fullName: input.fullName, phone: input.phone }).returning();
      const [c] = await tx.insert(complexes).values({ name: input.complexName, type: input.complexType }).returning();
      await tx.insert(memberships).values({ userId: u.id, complexId: c.id, role: 'OWNER' });
      await this.ledger.seedChart(c.id, tx);
      await this.audit.log({ complexId: c.id, userId: u.id, action: 'REGISTER', entity: 'user', entityId: u.id }, tx);
      return u;
    });
    return this.issueTokens(user);
  }

  async login(email: string, password: string) {
    const [u] = await this.db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
    // Comparación siempre ejecutada para no filtrar existencia de cuentas por tiempo de respuesta.
    const ok = await bcrypt.compare(password, u?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    if (!u || !ok) throw new UnauthorizedException('Credenciales inválidas');
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    return this.issueTokens(u);
  }

  async refresh(refreshToken: string) {
    let p: { sub: string; ver: number };
    try {
      p = await this.jwt.verifyAsync(refreshToken, { secret: env.JWT_REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
    const [u] = await this.db.select().from(users).where(eq(users.id, p.sub));
    if (!u || u.tokenVersion !== p.ver) throw new UnauthorizedException('Sesión revocada');
    return this.issueTokens(u);
  }

  /** Cierra todas las sesiones del usuario (invalida tokens emitidos). */
  async logoutAll(userId: string) {
    await this.db.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, userId));
  }

  async changePassword(userId: string, current: string, next: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new BadRequestException('La contraseña actual no es correcta');
    await this.db
      .update(users)
      .set({ passwordHash: await this.hash(next), tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const [fresh] = await this.db.select().from(users).where(eq(users.id, userId));
    return this.issueTokens(fresh);
  }

  private async issueTokens(u: { id: string; email: string; tokenVersion: number }) {
    const accessToken = await this.jwt.signAsync(
      { sub: u.id, email: u.email, ver: u.tokenVersion },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: u.id, ver: u.tokenVersion },
      { secret: env.JWT_REFRESH_SECRET, expiresIn: env.JWT_REFRESH_TTL_SECONDS },
    );
    return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_TTL_SECONDS };
  }
}
