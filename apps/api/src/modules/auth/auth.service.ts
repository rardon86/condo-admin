import { BadRequestException, ConflictException, Inject, Injectable, Logger, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { and, eq, or, sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { DB, Db } from '../../db/client';
import { complexes, memberships, units, users } from '../../db/schema';
import { AuditService } from '../../common/audit.service';

const BCRYPT_ROUNDS = 12;

export interface ResidentRegisterInput {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  complexId: string;
  unitCode: string;
}

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  hash(password: string) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /** Crea el superusuario inicial si se configuró y aún no existe. Nunca cambia una contraseña existente. */
  async onApplicationBootstrap() {
    const username = env.SUPERADMIN_USERNAME?.toLowerCase();
    if (!username || !env.SUPERADMIN_PASSWORD) return;
    const [existing] = await this.db.select().from(users).where(eq(users.username, username));
    if (existing) {
      if (!existing.isSuperAdmin) await this.db.update(users).set({ isSuperAdmin: true }).where(eq(users.id, existing.id));
      return;
    }
    const email = (env.SUPERADMIN_EMAIL ?? `${username}@plataforma.local`).toLowerCase();
    await this.db
      .insert(users)
      .values({ username, email, fullName: username[0].toUpperCase() + username.slice(1), passwordHash: await this.hash(env.SUPERADMIN_PASSWORD), isSuperAdmin: true })
      .onConflictDoNothing();
    this.logger.log(`Superusuario "${username}" creado`);
  }

  /**
   * Registro público de propietarios/residentes: la cuenta queda PENDIENTE en el proyecto elegido
   * hasta que un administrador la aprueba. No crea proyectos (eso lo hace el superusuario).
   */
  async registerResident(input: ResidentRegisterInput) {
    const email = input.email.toLowerCase().trim();
    const [exists] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new ConflictException('Ya existe una cuenta con ese correo');
    const [complex] = await this.db.select().from(complexes).where(and(eq(complexes.id, input.complexId), eq(complexes.active, true)));
    if (!complex) throw new BadRequestException('Proyecto no válido');
    const [unit] = await this.db
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.complexId, complex.id), sql`lower(${units.code}) = ${input.unitCode.trim().toLowerCase()}`));
    const passwordHash = await this.hash(input.password);

    const user = await this.db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email, passwordHash, fullName: input.fullName, phone: input.phone }).returning();
      await tx.insert(memberships).values({ userId: u.id, complexId: complex.id, role: 'RESIDENT', status: 'PENDING', unitId: unit?.id ?? null });
      await this.audit.log(
        { complexId: complex.id, userId: u.id, action: 'REGISTER_RESIDENT', entity: 'user', entityId: u.id, data: { unitCode: input.unitCode, unitFound: !!unit } },
        tx,
      );
      return u;
    });
    return this.issueTokens(user);
  }

  /** Inicio de sesión con correo o nombre de usuario. */
  async login(identifier: string, password: string) {
    const id = identifier.toLowerCase().trim();
    const [u] = await this.db.select().from(users).where(or(eq(users.email, id), eq(users.username, id)));
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
