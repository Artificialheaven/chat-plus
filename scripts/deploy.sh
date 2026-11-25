#!/usr/bin/env bash
# 构建并发布静态站点：安装依赖 → 类型检查 → 测试 → 构建 → 同步到站点目录。
#   SITE_DIR=/var/www/example.com ./scripts/deploy.sh
#   RELOAD_NGINX=0 ./scripts/deploy.sh     # 不改 nginx 时跳过 reload
set -euo pipefail

REPO_DIR=${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
SITE_DIR=${SITE_DIR:-/var/www/syd.eastcloud.top}
DEPLOY_OWNER=${DEPLOY_OWNER:-www-data:www-data}
RELOAD_NGINX=${RELOAD_NGINX:-1}

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

cd "$REPO_DIR"

echo "[1/5] 安装依赖"
pnpm install --frozen-lockfile

echo "[2/5] 类型检查"
pnpm type

echo "[3/5] 单元测试"
pnpm test

echo "[4/5] 构建"
pnpm build

echo "[5/5] 发布到 $SITE_DIR"
$SUDO mkdir -p "$SITE_DIR"
$SUDO rsync -a --delete --chown="$DEPLOY_OWNER" "$REPO_DIR/dist/" "$SITE_DIR/"
$SUDO find "$SITE_DIR" -type d -exec chmod 755 {} \;
$SUDO find "$SITE_DIR" -type f -exec chmod 644 {} \;

if [ "$RELOAD_NGINX" = "1" ]; then
  $SUDO nginx -t
  $SUDO systemctl reload nginx
fi

echo "✓ 已发布：$(du -sh "$SITE_DIR" | cut -f1)，共 $(find "$SITE_DIR" -type f | wc -l) 个文件"
