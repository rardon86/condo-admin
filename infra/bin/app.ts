#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { RegistryStack, ResidencialStack } from '../lib/residencial-stack';

const app = new App();
const envName = app.node.tryGetContext('env') ?? 'prod';

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' };

new RegistryStack(app, `Residencial-${envName}-registry`, { envName, env });
new ResidencialStack(app, `Residencial-${envName}`, {
  envName,
  env,
  // Opcional: dominio propio con certificado ACM (us-east-1) para CloudFront.
  domainName: app.node.tryGetContext('domainName'),
  certificateArn: app.node.tryGetContext('certificateArn'),
});
