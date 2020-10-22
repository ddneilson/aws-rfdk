/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  expect as cdkExpect,
  haveResourceLike,
} from '@aws-cdk/assert';
import {
  AmazonLinuxGeneration,
  Instance,
  InstanceType,
  MachineImage,
  Port,
  Vpc,
  WindowsVersion,
} from '@aws-cdk/aws-ec2';
import {
  Stack,
} from '@aws-cdk/core';

import {
  MountableNfs,
  MountPermissions,
  NfsVersion,
} from '../lib';

import {
  escapeTokenRegex,
} from './token-regex-helpers';

describe('Test MountableNfs', () => {
  let stack: Stack;
  let vpc: Vpc;
  let instance: Instance;

  beforeEach(() => {
    stack = new Stack();
    vpc = new Vpc(stack, 'Vpc');
    instance = new Instance(stack, 'Instance', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestAmazonLinux({ generation: AmazonLinuxGeneration.AMAZON_LINUX_2 }),
    });
  });

  test('defaults', () => {
    // GIVEN
    const server = new Instance(stack, 'Server', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestAmazonLinux({ generation: AmazonLinuxGeneration.AMAZON_LINUX_2 }),
    });
    const mount = new MountableNfs(stack, {
      nfsVersion: NfsVersion.NFS,
      hostname: 'server.dns',
      exportPath: '/export',
      hostConnections: server.connections,
    });

    // WHEN
    mount.mountToLinuxInstance(instance, {
      location: '/mnt/nfs',
    });
    const userData = instance.userData.render();
    // THEN

    // Make sure the instance has been granted ingress to the server's security group
    for (let port of [111, 2049]) {
      for (let proto of ['tcp', 'udp']) {
        cdkExpect(stack).to(haveResourceLike('AWS::EC2::SecurityGroupIngress', {
          IpProtocol: proto,
          FromPort: port,
          ToPort: port,
          SourceSecurityGroupId: {
            'Fn::GetAtt': [
              'InstanceInstanceSecurityGroupF0E2D5BE',
              'GroupId',
            ],
          },
          GroupId: {
            'Fn::GetAtt': [
              'ServerInstanceSecurityGroup71D53DD9',
              'GroupId',
            ],
          },
        }));
      }
    }
    // Make sure we download the mountEfs script asset bundle
    const s3Copy = 'aws s3 cp \'s3://${Token[TOKEN.\\d+]}/${Token[TOKEN.\\d+]}${Token[TOKEN.\\d+]}\' \'/tmp/${Token[TOKEN.\\d+]}${Token[TOKEN.\\d+]}\'';
    expect(userData).toMatch(new RegExp(escapeTokenRegex(s3Copy)));
    expect(userData).toMatch(new RegExp(escapeTokenRegex('unzip /tmp/${Token[TOKEN.\\d+]}${Token[TOKEN.\\d+]}')));
    // Make sure we execute the script with the correct args
    expect(userData).toMatch(new RegExp(escapeTokenRegex('bash ./mountNfs.sh nfs server.dns \'/export\' \'/mnt/nfs\' rw')));
  });

  test('allow extra port access', () => {
    // GIVEN
    const server = new Instance(stack, 'Server', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestAmazonLinux({ generation: AmazonLinuxGeneration.AMAZON_LINUX_2 }),
    });
    const mount = new MountableNfs(stack, {
      nfsVersion: NfsVersion.NFS,
      hostname: 'server.dns',
      exportPath: '/export',
      hostConnections: server.connections,
      hostExtraPorts: [ Port.tcp(1234), Port.udp(5678) ],
    });

    // WHEN
    mount.mountToLinuxInstance(instance, {
      location: '/mnt/nfs',
    });
    // THEN

    // Make sure the instance has been granted ingress to the server's security group on the extra ports
    for (let extraPort of [
      { proto: 'tcp', port: 1234 },
      { proto: 'udp', port: 5678 },
    ]) {
      cdkExpect(stack).to(haveResourceLike('AWS::EC2::SecurityGroupIngress', {
        IpProtocol: extraPort.proto,
        FromPort: extraPort.port,
        ToPort: extraPort.port,
        SourceSecurityGroupId: {
          'Fn::GetAtt': [
            'InstanceInstanceSecurityGroupF0E2D5BE',
            'GroupId',
          ],
        },
        GroupId: {
          'Fn::GetAtt': [
            'ServerInstanceSecurityGroup71D53DD9',
            'GroupId',
          ],
        },
      }));
    }
  });

  test('uses nfsv4', () => {
    // GIVEN
    const server = new Instance(stack, 'Server', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestAmazonLinux({ generation: AmazonLinuxGeneration.AMAZON_LINUX_2 }),
    });
    const mount = new MountableNfs(stack, {
      nfsVersion: NfsVersion.NFS_V4,
      hostname: 'server.dns',
      exportPath: '/export',
      hostConnections: server.connections,
    });

    // WHEN
    mount.mountToLinuxInstance(instance, {
      location: '/mnt/nfs',
    });
    const userData = instance.userData.render();
    // THEN

    // Make sure we execute the script with the correct args
    expect(userData).toMatch(new RegExp(escapeTokenRegex('bash ./mountNfs.sh nfs4 server.dns \'/export\' \'/mnt/nfs\' rw')));
  });

  test('assert Linux-only', () => {
    // GIVEN
    const windowsInstance = new Instance(stack, 'WindowsInstance', {
      vpc,
      instanceType: new InstanceType('t3.small'),
      machineImage: MachineImage.latestWindows(WindowsVersion.WINDOWS_SERVER_2019_ENGLISH_FULL_SQL_2017_STANDARD),
    });
    const mount = new MountableNfs(stack, {
      nfsVersion: NfsVersion.NFS,
      hostname: 'server.dns',
      exportPath: '/export',
    });

    // THEN
    expect(() => {
      mount.mountToLinuxInstance(windowsInstance, {
        location: '/mnt/nfs',
        permissions: MountPermissions.READONLY,
      });
    }).toThrowError('Target instance must be Linux.');
  });

  test('readonly mount', () => {
    // GIVEN
    const mount = new MountableNfs(stack, {
      nfsVersion: NfsVersion.NFS,
      hostname: 'server.dns',
      exportPath: '/export',
    });

    // WHEN
    mount.mountToLinuxInstance(instance, {
      location: '/mnt/nfs',
      permissions: MountPermissions.READONLY,
    });
    const userData = instance.userData.render();

    // THEN
    expect(userData).toMatch(new RegExp(escapeTokenRegex('bash ./mountNfs.sh nfs server.dns \'/export\' \'/mnt/nfs\' r')));
  });

  test('extra mount options', () => {
    // GIVEN
    const mount = new MountableNfs(stack, {
      nfsVersion: NfsVersion.NFS,
      hostname: 'server.dns',
      exportPath: '/export',
      linuxOptions: {
        extraMountOptions: [
          'option1',
          'option2',
        ],
      },
    });


    // WHEN
    mount.mountToLinuxInstance(instance, {
      location: '/mnt/nfs',
    });
    const userData = instance.userData.render();

    // THEN
    expect(userData).toMatch(new RegExp(escapeTokenRegex('bash ./mountNfs.sh nfs server.dns \'/export\' \'/mnt/nfs\' rw,option1,option2')));
  });

  test('asset is singleton', () => {
    // GIVEN
    const mount1 = new MountableNfs(stack, {
      nfsVersion: NfsVersion.NFS,
      hostname: 'server.dns',
      exportPath: '/export',
    });
    const mount2 = new MountableNfs(stack, {
      nfsVersion: NfsVersion.NFS,
      hostname: 'server.dns',
      exportPath: '/export',
    });

    // WHEN
    mount1.mountToLinuxInstance(instance, {
      location: '/mnt/nfs',
    });
    mount2.mountToLinuxInstance(instance, {
      location: '/mnt/nfs2',
    });
    const userData = instance.userData.render();
    const s3Copy = 'aws s3 cp \'s3://${Token[TOKEN.\\d+]}/${Token[TOKEN.\\d+]}${Token[TOKEN.\\d+]}\'';
    const regex = new RegExp(escapeTokenRegex(s3Copy), 'g');
    const matches = userData.match(regex) ?? [];

    // THEN
    // The source of the asset copy should be identical from mount1 & mount2
    expect(matches).toHaveLength(2);
    expect(matches[0]).toBe(matches[1]);
  });
});
