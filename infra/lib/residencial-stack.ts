import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, StackProps, TimeZone } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as autoscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

/**
 * Horario de servicio (hora de El Salvador): fuera de él se apagan la API y la base de datos para ahorrar.
 * La web (CloudFront/S3) sigue respondiendo y muestra el aviso de "fuera de horario".
 * Debe coincidir con SERVICE_HOURS en apps/web/src/lib/api.ts.
 */
export const SERVICE_HOURS = { timeZone: 'America/El_Salvador', start: 9, end: 18 };

export const repositoryName = (envName: string) => `residencial-api-${envName}`;

/** Repositorio ECR en su propio stack: debe existir (con una imagen) antes de crear el servicio ECS. */
export class RegistryStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { envName: string }) {
    super(scope, id, props);
    const repo = new ecr.Repository(this, 'ApiRepo', {
      repositoryName: repositoryName(props.envName),
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 20 }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    new CfnOutput(this, 'EcrRepository', { value: repo.repositoryUri });
  }
}

export interface ResidencialStackProps extends StackProps {
  envName: string;
  domainName?: string;
  certificateArn?: string;
}

/**
 * Arquitectura en AWS:
 *   CloudFront ─┬─ /*      → S3 (SPA React, privado con OAC)
 *               └─ /api/*  → ALB → ECS Fargate (API NestJS, subredes privadas)
 *                                     └─ RDS PostgreSQL 16 (subred aislada, cifrado, backups)
 *   Secretos en Secrets Manager · Imágenes en ECR · Logs en CloudWatch
 */
export class ResidencialStack extends Stack {
  constructor(scope: Construct, id: string, props: ResidencialStackProps) {
    super(scope, id, props);
    const prod = props.envName === 'prod';

    // ── Red: 2 AZ, 1 NAT (subir a 2 para alta disponibilidad total) ──
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'db', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });

    // ── Base de datos ──
    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret('app'),
      databaseName: 'residencial',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false, // activar en producción con más carga
      backupRetention: Duration.days(prod ? 14 : 3),
      deletionProtection: prod,
      removalPolicy: prod ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ['postgresql'],
      // Respaldo automático dentro del horario de servicio (una instancia apagada no se respalda): 9:30–10:00 SV
      preferredBackupWindow: '15:30-16:00',
    });

    const jwt = new secrets.Secret(this, 'JwtSecrets', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'access',
        passwordLength: 64,
        excludePunctuation: true,
      },
    });
    const jwtRefresh = new secrets.Secret(this, 'JwtRefreshSecret', {
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    // Superusuario inicial de la plataforma (se crea al arrancar si no existe).
    // La contraseña llega desde el secreto de GitHub SUPERADMIN_PASSWORD; nunca va en el repositorio.
    const superAdminPassword = process.env.SUPERADMIN_PASSWORD;
    const superAdmin = superAdminPassword
      ? new secrets.Secret(this, 'SuperAdminPassword', { secretStringValue: SecretValue.unsafePlainText(superAdminPassword) })
      : undefined;

    // ── API en ECS Fargate (la imagen vive en el repositorio ECR del RegistryStack) ──
    const repo = ecr.Repository.fromRepositoryName(this, 'ApiRepo', repositoryName(props.envName));

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Api', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      publicLoadBalancer: true,
      // El ALB no queda abierto a internet: solo acepta tráfico desde CloudFront (ver más abajo)
      openListener: false,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(repo, process.env.IMAGE_TAG ?? 'latest'),
        containerPort: 3000,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logRetention: logs.RetentionDays.ONE_MONTH }),
        environment: {
          NODE_ENV: 'production',
          PORT: '3000',
          DATABASE_SSL: 'true',
          RUN_MIGRATIONS: 'true',
          CORS_ORIGINS: props.domainName ? `https://${props.domainName}` : '*',
          SUPERADMIN_USERNAME: process.env.SUPERADMIN_USERNAME ?? 'ricardo',
        },
        secrets: {
          DB_HOST: ecs.Secret.fromSecretsManager(db.secret!, 'host'),
          DB_PORT: ecs.Secret.fromSecretsManager(db.secret!, 'port'),
          DB_NAME: ecs.Secret.fromSecretsManager(db.secret!, 'dbname'),
          DB_USER: ecs.Secret.fromSecretsManager(db.secret!, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, 'password'),
          JWT_ACCESS_SECRET: ecs.Secret.fromSecretsManager(jwt, 'access'),
          JWT_REFRESH_SECRET: ecs.Secret.fromSecretsManager(jwtRefresh),
          ...(superAdmin ? { SUPERADMIN_PASSWORD: ecs.Secret.fromSecretsManager(superAdmin) } : {}),
        },
      },
    });
    api.targetGroup.configureHealthCheck({ path: '/api/health', healthyHttpCodes: '200' });
    db.connections.allowDefaultPortFrom(api.service, 'API a PostgreSQL');

    // Solo CloudFront puede llegar al balanceador: así nadie evita el WAF entrando directo al ALB.
    const cloudFrontPrefixList = ec2.PrefixList.fromLookup(this, 'CloudFrontOriginFacing', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    api.loadBalancer.connections.allowFrom(ec2.Peer.prefixList(cloudFrontPrefixList.prefixListId), ec2.Port.tcp(80), 'Solo CloudFront');

    const scaling = api.service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 6 });
    scaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 65 });

    // ── Apagado fuera del horario de servicio (ahorro) ──
    // Noche: la API baja a 0 tareas a la hora de cierre y 5 min después se detiene RDS.
    // Mañana: RDS arranca 20 min antes de la apertura (tarda ~10 min) y la API vuelve a 1–6 tareas.
    const tz = TimeZone.of(SERVICE_HOURS.timeZone);
    scaling.scaleOnSchedule('Cierre', {
      schedule: autoscaling.Schedule.cron({ hour: String(SERVICE_HOURS.end), minute: '0' }),
      timeZone: tz, minCapacity: 0, maxCapacity: 0,
    });
    scaling.scaleOnSchedule('Apertura', {
      schedule: autoscaling.Schedule.cron({ hour: String(SERVICE_HOURS.start), minute: '0' }),
      timeZone: tz, minCapacity: 1, maxCapacity: 6,
    });
    const dbSchedulerRole = new iam.Role(this, 'DbSchedulerRole', { assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') });
    dbSchedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['rds:StopDBInstance', 'rds:StartDBInstance'],
      resources: [db.instanceArn],
    }));
    const dbSchedule = (id: string, action: 'stopDBInstance' | 'startDBInstance', hour: number, minute: number) =>
      new scheduler.CfnSchedule(this, id, {
        description: `${action} fuera del horario de servicio (${props.envName})`,
        scheduleExpression: `cron(${minute} ${hour} * * ? *)`,
        scheduleExpressionTimezone: SERVICE_HOURS.timeZone,
        flexibleTimeWindow: { mode: 'OFF' },
        target: {
          arn: `arn:aws:scheduler:::aws-sdk:rds:${action}`,
          roleArn: dbSchedulerRole.roleArn,
          input: JSON.stringify({ DbInstanceIdentifier: db.instanceIdentifier }),
          retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 3600 },
        },
      });
    dbSchedule('DbStop', 'stopDBInstance', SERVICE_HOURS.end, 5);
    dbSchedule('DbStart', 'startDBInstance', SERVICE_HOURS.start - 1, 40);

    // ── Frontend: S3 privado + CloudFront ──
    const site = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ── WAF (firewall de aplicaciones) delante de CloudFront ──
    // Nota: los WebACL de CloudFront deben crearse en us-east-1 (región de este stack).
    const metric = (name: string) => ({ cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true });
    const managed = (name: string, priority: number, countOnly: string[] = []): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name,
          ruleActionOverrides: countOnly.map((r) => ({ name: r, actionToUse: { count: {} } })),
        },
      },
      visibilityConfig: metric(name),
    });
    const waf = new wafv2.CfnWebACL(this, 'Waf', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: metric(`residencial-${props.envName}-waf`),
      rules: [
        {
          // Anti-DoS: máximo 1.500 solicitudes por IP cada 5 minutos
          name: 'RateLimitPorIp',
          priority: 0,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: 1500, aggregateKeyType: 'IP' } },
          visibilityConfig: metric('RateLimitPorIp'),
        },
        {
          // Anti fuerza bruta: máximo 60 intentos de login/registro por IP cada 5 minutos
          name: 'RateLimitAuth',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 60,
              aggregateKeyType: 'IP',
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: 'STARTS_WITH',
                  searchString: '/api/auth/',
                  textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                },
              },
            },
          },
          visibilityConfig: metric('RateLimitAuth'),
        },
        managed('AWSManagedRulesAmazonIpReputationList', 2),
        // SizeRestrictions_BODY solo se cuenta: los logos (≤ 300 KB) superan el límite de 8 KB de la regla
        managed('AWSManagedRulesCommonRuleSet', 3, ['SizeRestrictions_BODY']),
        managed('AWSManagedRulesKnownBadInputsRuleSet', 4),
        managed('AWSManagedRulesSQLiRuleSet', 5),
      ],
    });

    // ── Cabeceras de seguridad ──
    const securityHeaders = (name: string, csp: string) =>
      new cloudfront.ResponseHeadersPolicy(this, name, {
        securityHeadersBehavior: {
          contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
          strictTransportSecurity: { accessControlMaxAge: Duration.days(730), includeSubdomains: true, preload: true, override: true },
          contentTypeOptions: { override: true },
          frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
          referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        },
        customHeadersBehavior: {
          customHeaders: [
            { header: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()', override: true },
            { header: 'Cross-Origin-Opener-Policy', value: 'same-origin', override: true },
          ],
        },
        removeHeaders: ['Server'],
      });
    const webHeaders = securityHeaders(
      'WebSecurityHeaders',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
      ].join('; '),
    );
    const apiHeaders = securityHeaders('ApiSecurityHeaders', "default-src 'none'; frame-ancestors 'none'");

    // SPA: las rutas del cliente (sin extensión) se sirven con index.html. Se hace con una función
    // en el comportamiento del frontend para no alterar las respuestas de error de la API.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (!r.uri.includes('.')) { r.uri = '/index.html'; } return r; }",
      ),
    });

    const apiOrigin = new origins.LoadBalancerV2Origin(api.loadBalancer, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY });
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      defaultRootObject: 'index.html',
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate: props.certificateArn ? acm.Certificate.fromCertificateArn(this, 'Cert', props.certificateArn) : undefined,
      // TLS mínimo 1.2 (aplica con dominio propio; el dominio *.cloudfront.net lo gestiona AWS)
      minimumProtocolVersion: props.certificateArn ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      webAclId: waf.attrArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: webHeaders,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: apiHeaders,
        },
      },
    });

    new CfnOutput(this, 'AppUrl', { value: `https://${props.domainName ?? distribution.distributionDomainName}` });
    new CfnOutput(this, 'WebBucket', { value: site.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: api.service.serviceName });
  }
}
