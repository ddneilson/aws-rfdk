/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';

import {
  Connections,
  OperatingSystemType,
  Port,
} from '@aws-cdk/aws-ec2';
import {
  Asset,
} from '@aws-cdk/aws-s3-assets';
import {
  Construct,
  Stack,
} from '@aws-cdk/core';

import {
  MountPermissionsHelper,
} from './mount-permissions-helper';
import {
  IMountableLinuxFilesystem,
  IMountingInstance,
  LinuxMountPointProps,
} from './mountable-filesystem';

/**
 * TODO
 */
export enum NfsVersion {
  /**
   * TODO
   */
  NFS = 'nfs',

  /**
   * TODO
   */
  NFS_V4 = 'nfs4'
}

/**
 * TODO
 */
export interface NfsLinuxProps {
  /**
   * Extra NFS mount options that will be added to /etc/fstab for the file system.
   * See: {@link https://www.man7.org/linux/man-pages//man5/nfs.5.html}
   *
   * The given values will be joined together into a single string by commas.
   * ex: ['soft', 'rsize=4096'] will become 'soft,rsize=4096'
   *
   * @default No extra options.
   */
  readonly extraMountOptions?: string[];
}

/**
 * Properties that are required to create a {@link MountableEfs}.
 */
export interface MountableNfsProps {
  /**
   * The version of the NFS client that is used to mount the NFS.
   */
  readonly nfsVersion: NfsVersion;

  /**
   * The hostname or IP address for the host of the NFS filesystem
   */
  readonly hostname: string;

  /**
   * The exported path from the NFS server that will be mounted by the
   * MountableNfs helper.
   */
  readonly exportPath: string;

  /**
   * If access to the NFS host requires access to a Security Group, then
   * this property can be used to provide that Security Group. It is used
   * by the MountableNfs helper to grant access to the NFS host by any
   * target that is mounting it.
   *
   * @default None
   */
  readonly hostConnections?: Connections;

  /**
   * Extra ports that any client requires access to on the NFS host when mounting
   * the NFS. These ports are in addition to port 111 udp/tcp (portmapper), and
   * 2049 udp/tcp (nfsd) that are automatically granted access when using the
   * MountableNfs helper.
   *
   * @default No extra ports.
   */
  readonly hostExtraPorts?: Port[];

  /**
   * Platform-specific properties for Linux clients when they mount the NFS
   * file share.
   *
   * @default No extra linux-specific options
   */
  readonly linuxOptions?: NfsLinuxProps;
}

/**
 * This class encapsulates scripting that can be used to mount an existing NFS onto an instance.
 *
 * Security Considerations
 * ------------------------
 * - Using this construct on an instance will result in that instance dynamically downloading and running scripts
 *   from your CDK bootstrap bucket when that instance is launched. You must limit write access to your CDK bootstrap
 *   bucket to prevent an attacker from modifying the actions performed by these scripts. We strongly recommend that
 *   you either enable Amazon S3 server access logging on your CDK bootstrap bucket, or enable AWS CloudTrail on your
 *   account to assist in post-incident analysis of compromised production environments.
 */
export class MountableNfs implements IMountableLinuxFilesystem {
  constructor(protected readonly scope: Construct, protected readonly props: MountableNfsProps) {}

  /**
   * @inheritdoc
   */
  public mountToLinuxInstance(target: IMountingInstance, mount: LinuxMountPointProps): void {
    if (target.osType !== OperatingSystemType.LINUX) {
      throw new Error('Target instance must be Linux.');
    }

    if (this.props.hostConnections) {
      // Ports:
      //  * 111 -- portmap
      //  * 2049 -- nfsd
      for (let port of [111, 2049]) {
        target.connections.allowTo(this.props.hostConnections, Port.tcp(port));
        target.connections.allowTo(this.props.hostConnections, Port.udp(port));
      }
      for (let port of this.props.hostExtraPorts ?? []) {
        target.connections.allowTo(this.props.hostConnections, port);
      }
    }

    const mountScriptAsset = this.mountAssetSingleton();
    mountScriptAsset.grantRead(target.grantPrincipal);
    const mountScript: string = target.userData.addS3DownloadCommand({
      bucket: mountScriptAsset.bucket,
      bucketKey: mountScriptAsset.s3ObjectKey,
    });

    const mountDir: string = path.posix.normalize(mount.location);
    const mountOptions: string[] = [ MountPermissionsHelper.toLinuxMountOption(mount.permissions) ];
    if (this.props.linuxOptions?.extraMountOptions) {
      mountOptions.push( ...this.props.linuxOptions!.extraMountOptions);
    }
    const mountOptionsStr: string = mountOptions.join(',');

    const exportPath = this.props.exportPath;
    target.userData.addCommands(
      'TMPDIR=$(mktemp -d)',
      'pushd "$TMPDIR"',
      `unzip ${mountScript}`,
      `bash ./mountNfs.sh ${this.props.nfsVersion} ${this.props.hostname} '${exportPath}' '${mountDir}' ${mountOptionsStr}`,
      'popd',
      `rm -f ${mountScript}`,
    );
  }

  /**
   * Fetch the Asset singleton for the EFS mounting scripts, or generate it if needed.
   */
  protected mountAssetSingleton(): Asset {
    const stack = Stack.of(this.scope);
    const uuid = 'bc791c1b-2b48-4712-bf58-0f96e31320c6';
    const uniqueId = 'MountableNfsAsset' + uuid.replace(/[-]/g, '');
    return (stack.node.tryFindChild(uniqueId) as Asset) ?? new Asset(stack, uniqueId, {
      path: path.join(__dirname, '..', 'scripts', 'bash'),
      exclude: [ '**/*', '!mountNfs.sh' ],
    });
  }
}
