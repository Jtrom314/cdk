import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import { CfnOutput } from 'aws-cdk-lib';

export class JwtPizzaServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 3,
      natGateways: 1,
    });
    vpc.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Create Security Groups
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc,
      description: 'Allow HTTP and HTTPS traffic to ALB',
      allowAllOutbound: true,
    });
    albSecurityGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic');
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS traffic');

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Allow HTTP traffic to ECS tasks',
      allowAllOutbound: true,
    });
    ecsSecurityGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    ecsSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80), 'Allow traffic from ALB');

    // Create Certificate
    const certificate = new certificatemanager.Certificate(this, 'Certificate', {
      domainName: 'yourdomain.com',
      validation: certificatemanager.CertificateValidation.fromDns(),
    });
    certificate.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // ECS Cluster
    const ecsCluster = new ecs.Cluster(this, 'ECSCluster', {
      clusterName: 'jwt-pizza-service',
      vpc
    });
    ecsCluster.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Load Balancer
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      loadBalancerName: 'jwt-pizza-service',
    });
    loadBalancer.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        protocol: elbv2.Protocol.HTTP
      },
      deregistrationDelay: cdk.Duration.seconds(300),
      targetGroupName: 'jwt-pizza-service'
    });

    // Listener
    const listener = new elbv2.ApplicationListener(this, 'Listener', {
      loadBalancer,
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [{ certificateArn: certificate.certificateArn }],
      defaultAction: elbv2.ListenerAction.forward([targetGroup]),
    });
    listener.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // ECS Task Definition
    const taskDefinition = ecs.TaskDefinition.fromTaskDefinitionArn(
      this, 'TaskDefinition',
      `arn:aws:ecs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:task-definition/jwt-pizza-service:1` // You can update the version as needed
    );

    // ECS Service
    const ecsService = new ecs.FargateService(this, 'ECSService', {
      cluster: ecsCluster,
      serviceName: 'jwt-pizza-service',
      taskDefinition,
      desiredCount: 1,
      loadBalancers: [{
        containerName: 'jwt-pizza-service',
        containerPort: 80,
        targetGroupArn: targetGroup.targetGroupArn
      }],
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: true,
      vpcSubnets: { subnets: vpc.privateSubnets },
      capacityProviderStrategies: [{
        capacityProvider: 'FARGATE',
        base: 0,
        weight: 1
      }],
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS
      },
      deploymentCircuitBreaker: {
        rollback: true
      },
      enableECSManagedTags: true,
      platformVersion: ecs.FargatePlatformVersion.LATEST,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Outputs
    new CfnOutput(this, 'ClusterName', {
      description: 'Cluster',
      value: ecsCluster.clusterName
    });

    new CfnOutput(this, 'ECSServiceOutput', {
      description: 'Service',
      value: 'jwt-pizza-service'
    });

    new CfnOutput(this, 'LoadBalancerOutput', {
      description: 'Load balancer',
      value: loadBalancer.loadBalancerName
    });

    new CfnOutput(this, 'ListenerOutput', {
      description: 'Load balancer listener',
      value: listener.listenerArn
    });

    new CfnOutput(this, 'TargetGroupOutput', {
      description: 'Load balancer target group',
      value: targetGroup.targetGroupName
    });
  }
}

const app = new cdk.App();
new JwtPizzaServiceStack(app, 'JwtPizzaServiceStack');
