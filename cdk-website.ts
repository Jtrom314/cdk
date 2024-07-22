import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dotenv from "dotenv";

dotenv.config();

export class JwtPizzaCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = process.env.DOMAIN_NAME || ''
    const prodDomain = `pizza.${domainName}`;
    const stageDomain = `stage-pizza.${domainName}`;

    // Create S3 bucket
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: prodDomain,
      websiteIndexDocument: 'index.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Upload content to S3 bucket
    new s3Deployment.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3Deployment.Source.asset('./website-content')],
      destinationBucket: websiteBucket,
    });

    // Create SSL certificate
    const certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName: prodDomain,
      subjectAlternativeNames: [stageDomain],
      validation: acm.CertificateValidation.fromDns(),
    });

    // Create CloudFront distribution for production
    const prodDistribution = new cloudfront.Distribution(this, 'ProdSiteDistribution', {
      defaultRootObject: 'index.html',
      domainNames: [prodDomain],
      certificate: certificate,
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, { originPath: '/production' }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
    });

    // Create CloudFront distribution for staging
    const stageDistribution = new cloudfront.Distribution(this, 'StageSiteDistribution', {
      defaultRootObject: 'index.html',
      domainNames: [stageDomain],
      certificate: certificate,
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, { originPath: '/staging' }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
    });

    // Update S3 bucket policy for CloudFront access - Production
    websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [websiteBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${prodDistribution.distributionId}`
        }
      }
    }));

    // Update S3 bucket policy for CloudFront access - Staging
    websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [websiteBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${stageDistribution.distributionId}`
        }
      }
    }));

    // Create Route 53 records for production and staging
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', { domainName: domainName });

    new route53.ARecord(this, 'ProdSiteAliasRecord', {
      zone: hostedZone,
      recordName: 'pizza',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(prodDistribution)),
    });

    new route53.ARecord(this, 'StageSiteAliasRecord', {
      zone: hostedZone,
      recordName: 'stage-pizza',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(stageDistribution)),
    });

    // Create OIDC identity provider for Github
    const oidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com']
    })

    // Create IAM policy for deployment
    const deploymentPolicy = new iam.Policy(this, 'JwtPizzaCIDeploymentPolicy', {
        statements: [
            new iam.PolicyStatement({
                actions: ['s3:ListBucket'],
                resources: [websiteBucket.bucketArn]
            }),
            new iam.PolicyStatement({
                actions: ['s3:Object'],
                resources: [`${websiteBucket.bucketArn}/*`]
            }),
            new iam.PolicyStatement({
                actions: ['cloudfront:CreateInvalidation'],
                resources: [
                    `arn:aws:cloudfront::${this.account}:distribution/${prodDistribution.distributionId}`,
                    `arn:aws:cloudfront::${this.account}:distribution/${stageDistribution.distributionId}`
                ]
            })
        ]
    })

    // Create IAM role for Github Actions
    const githubRole = new iam.Role(this, 'GitHubCI', {
        
    })

    new cdk.CfnOutput(this, )
  }
}
