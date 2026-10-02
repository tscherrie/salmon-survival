#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export DEBIAN_FRONTEND=noninteractive
mkdir -p /out/apt-index /out/debs
cat > /etc/apt/sources.list <<'EOF'
deb https://snapshot.ubuntu.com/ubuntu/20250301T000000Z jammy main universe
deb https://snapshot.ubuntu.com/ubuntu/20250301T000000Z jammy-updates main universe
deb https://snapshot.ubuntu.com/ubuntu/20250301T000000Z jammy-security main universe
EOF
apt-get -o Acquire::Check-Valid-Until=false update
for package in autoconf automake libtool ragel pkg-config; do
  version=$(apt-cache policy "$package" | sed -n 's/^  Candidate: //p')
  test -n "$version" && test "$version" != '(none)'
  printf '%s=%s\n' "$package" "$version"
done > /out/core-build-package-requests.lock
apt-get --download-only --no-install-recommends -y \
  -o Dir::Cache::archives=/out/debs \
  install $(cat /out/core-build-package-requests.lock)
apt-get --no-install-recommends -y install $(cat /out/core-build-package-requests.lock)
dpkg-query -W -f='${binary:Package}\t${Version}\n' | sort > /out/core-build-container-packages.lock
find /var/lib/apt/lists -type f -name '*InRelease' -exec cp '{}' /out/apt-index/ \;
cd /out
find debs apt-index -type f -print0 | sort -z | xargs -0 sha256sum > apt-build-files.sha256
