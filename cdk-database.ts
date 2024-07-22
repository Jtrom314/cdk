import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as rds from '@aws-cdk/aws-rds';
import * as dotenv from "dotenv";

dotenv.config();

export class JwtPizzaServiceStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'JwtPizzaVpc', {
      maxAzs: 2, // Default is all AZs in region
      subnetConfiguration: [
        {
          name: 'isolatedSubnet',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        }
      ]
    });

    // Create the security group for the JWT Pizza Service
    const pizzaServiceSecurityGroup = new ec2.SecurityGroup(this, 'PizzaServiceSecurityGroup', {
      vpc,
      securityGroupName: 'jwt-pizza-service',
      description: 'Security group for the JWT Pizza Service',
      allowAllOutbound: true,
    });
    pizzaServiceSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic');
    pizzaServiceSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS traffic');

    // Create the security group for the RDS MySQL instance
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      securityGroupName: 'jwt-pizza-db',
      description: 'Security group for the JWT Pizza database',
      allowAllOutbound: true,
    });
    dbSecurityGroup.addIngressRule(pizzaServiceSecurityGroup, ec2.Port.tcp(3306), 'Allow MySQL traffic from Pizza Service');

    // Static password for RDS MySQL
    const dbPassword = 'H!v3CodeDB';

    // Create the RDS MySQL instance
    const dbInstance = new rds.DatabaseInstance(this, 'JwtPizzaDbInstance', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_21,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      multiAz: false,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      deletionProtection: false,
      databaseName: 'jwtpizzadb',
      credentials: {
        username: 'admin',
        password: cdk.SecretValue.plainText(dbPassword),
      },
      publiclyAccessible: false,
    });

    // Set the removal policy
    dbInstance.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Output the database endpoint
    new cdk.CfnOutput(this, 'DBEndpoint', {
      value: dbInstance.dbInstanceEndpointAddress,
    });

    // Output the database password securely
    new cdk.CfnOutput(this, 'DatabasePassword', {
      value: dbPassword,
    });
  }
}
