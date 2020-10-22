#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# This script will mount an Amazon Elastic File System (EFS) to a specified mount directory on this instance,
# and set up /etc/fstab so that the EFS is re-mounted on a system reboot.
#
# Note: This script uses get_metadata_token and get_region from ./metadataUtilities.sh
#  Thus, the system must have applications pre-installed as outlined in that file.
#
# Script arguments:
#  $1 -- NFS mount driver name (nfs or nfs4)
#  $2 -- NFS hostname/ip-address
#  $3 -- NFS export path; directory from the NFS server that's being mounted.
#  $4 -- Mount path; directory that we mount the NFS to.
#  $5 -- (optional) NFS mount options for the NFS. 

set -xeu

if test $# -lt 4
then
  echo "Usage: $0 <nfs version> <hostname> <export path> <mount path> [<mount options>]"
  exit 1
fi

SCRIPT_DIR=$(dirname $0)

NFS_CLIENT=$1
NFS_HOSTNAME=$2
EXPORT_PATH=$3
MOUNT_PATH=$4
MOUNT_OPTIONS="${5:-}"

sudo mkdir -p "${MOUNT_PATH}"

if which yum
then
  PACKAGE_MANAGER="yum"
  NFS_UTILS_PACAKGE="nfs-utils"
else
  PACKAGE_MANAGER="apt-get"
  NFS_UTILS_PACKAGE="nfs-common"
fi

function nfs_client_exists() {
  test -f "/sbin/mount.${NFS_CLIENT}" || sudo "${PACKAGE_MANAGER}" install -y "${NFS_UTILS_PACKAGE}"
}

# Attempt to mount the NFS file system

# fstab may be missing a newline at end of file.
if test $(tail -c 1 /etc/fstab | wc -l) -eq 0
then
  # Newline was missing, so add one.
  echo "" | sudo tee -a /etc/fstab
fi

if nfs_client_exists
then
  echo "${NFS_HOSTNAME}:${EXPORT_PATH} ${MOUNT_PATH} ${NFS_CLIENT} defaults,auto,_netdev,${MOUNT_OPTIONS} 0 0" | sudo tee -a /etc/fstab
else
  echo "Could not find suitable mount client to for NFS host ${NFS_HOSTNAME}"
  exit 1
fi

# We can sometimes fail to mount the NFS with a "Connection reset by host" error, or similar. 
# To counteract this, as best we can, we try to mount the NFS a handful of times and fail-out
# only if unable to mount it after that.
TRIES=0
MAX_TRIES=20
while test ${TRIES} -lt ${MAX_TRIES} && ! sudo mount -a -t ${NFS_CLIENT}
do
  let TRIES=TRIES+1
  sleep 2
done

# Check whether the drive as been mounted. Fail if not.
cat /proc/mounts | grep "${MOUNT_PATH}"
exit $?
