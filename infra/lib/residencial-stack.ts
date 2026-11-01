import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';

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
      desiredCount: prod ? 2 : 1,
      publicLoadBalancer: true,
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

    const scaling = api.service.autoScaleTaskCount({ minCapacity: prod ? 2 : 1, maxCapacity: 6 });
    scaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 65 });

    // ── Frontend: S3 privado + CloudFront ──
    const site = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const apiOrigin = new origins.LoadBalancerV2Origin(api.loadBalancer, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY });
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      defaultRootObject: 'index.html',
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate: props.certificateArn ? acm.Certificate.fromCertificateArn(this, 'Cert', props.certificateArn) : undefined,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // SPA: rutas del cliente devuelven index.html
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
    });

    new CfnOutput(this, 'AppUrl', { value: `https://${props.domainName ?? distribution.distributionDomainName}` });
    new CfnOutput(this, 'WebBucket', { value: site.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: api.service.serviceName });
  }
}
