import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { and, eq, or, sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { DB, Db } from '../../db/client';
import { complexes, memberships, units, users } from '../../db/schema';
import { AuditService } from '../../common/audit.service';
import { looksLikePhone, phoneUsername } from '../units/owners';

const BCRYPT_ROUNDS = 12;
/** Bloqueo temporal tras intentos fallidos consecutivos. */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** Hash real usado cuando el usuario no existe, para que el tiempo de respuesta no revele si la cuenta existe. */
const DUMMY_HASH = bcrypt.hashSync('cuenta-inexistente', BCRYPT_ROUNDS);

export interface ResidentRegisterInput {
  fullName: string;
  email?: string | null;
  password: string;
  /** Obligatorio: es su usuario de ingreso. */
  phone: string;
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
    const email = input.email ? input.email.toLowerCase().trim() : null;
    const username = phoneUsername(input.phone);
    const [byPhone] = await this.db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (byPhone) throw new ConflictException('Ya existe una cuenta con ese teléfono. Ingrese con él o pida acceso a la administración.');
    if (email) {
      const [byEmail] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (byEmail) throw new ConflictException('Ya existe una cuenta con ese correo');
    }
    const [complex] = await this.db.select().from(complexes).where(and(eq(complexes.id, input.complexId), eq(complexes.active, true)));
    if (!complex) throw new BadRequestException('Proyecto no válido');
    const [unit] = await this.db
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.complexId, complex.id), sql`lower(${units.code}) = ${input.unitCode.trim().toLowerCase()}`));
    const passwordHash = await this.hash(input.password);

    const user = await this.db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email, username, passwordHash, fullName: input.fullName, phone: input.phone }).returning();
      await tx.insert(memberships).values({ userId: u.id, complexId: complex.id, role: 'RESIDENT', status: 'PENDING', unitId: unit?.id ?? null });
      await this.audit.log(
        { complexId: complex.id, userId: u.id, action: 'REGISTER_RESIDENT', entity: 'user', entityId: u.id, data: { unitCode: input.unitCode, unitFound: !!unit } },
        tx,
      );
      return u;
    });
    return this.issueTokens(user);
  }

  /** Inicio de sesión con correo, nombre de usuario o teléfono (se compara por sus dígitos). */
  async login(identifier: string, password: string) {
    const raw = identifier.toLowerCase().trim();
    const id = looksLikePhone(raw) ? raw.replace(/\D/g, '') : raw;
    const [u] = await this.db.select().from(users).where(or(eq(users.email, id), eq(users.username, id)));
    // Comparación siempre ejecutada para no filtrar existencia de cuentas por tiempo de respuesta.
    const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
    if (u?.lockedUntil && u.lockedUntil > new Date()) {
      const min = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new HttpException(`Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${min} min.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!u || !ok) {
      if (u) {
        const failed = u.failedLogins + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await this.db
          .update(users)
          .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
          .where(eq(users.id, u.id));
        if (lock) this.logger.warn(`Cuenta ${u.id} bloqueada ${LOCK_MINUTES} min por intentos fallidos`);
      }
      throw new UnauthorizedException('Credenciales inválidas');
    }
    // Solo se informa después de validar la contraseña (no revela cuentas a terceros)
    if (!u.active) throw new UnauthorizedException('Cuenta desactivada. Contacte al administrador de la plataforma.');
    await this.db.update(users).set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
    return this.issueTokens(u);
  }

  async refresh(refreshToken: string) {
    let p: { sub: string; ver: number };
    try {
      p = await this.jwt.verifyAsync(refreshToken, { secret: env.JWT_REFRESH_SECRET, algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
    const [u] = await this.db.select().from(users).where(eq(users.id, p.sub));
    if (!u || u.tokenVersion !== p.ver || !u.active) throw new UnauthorizedException('Sesión revocada');
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

  private async issueTokens(u: { id: string; email: string | null; tokenVersion: number }) {
    const accessToken = await this.jwt.signAsync(
      { sub: u.id, email: u.email, ver: u.tokenVersion },
      { secret: env.JWT_ACCESS_SECRET, expiresIn: env.JWT_ACCESS_TTL_SECONDS, algorithm: 'HS256' },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: u.id, ver: u.tokenVersion },
      { secret: env.JWT_REFRESH_SECRET, expiresIn: env.JWT_REFRESH_TTL_SECONDS, algorithm: 'HS256' },
    );
    return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_TTL_SECONDS };
  }
}
