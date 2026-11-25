#!/usr/bin/env bash
# 打包站点与 DSH 会话数据，保留最近 KEEP_DAYS 天。
#   ./scripts/backup.sh            # 默认写到 ~/backups，保留 7 天
#   BACKUP_DIR=/data/bak KEEP_DAYS=30 ./scripts/backup.sh
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-"$HOME/backups"}
KEEP_DAYS=${KEEP_DAYS:-7}
SITE_DIR=${SITE_DIR:-/var/www/syd.eastcloud.top}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE="$BACKUP_DIR/chat-plus-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

# 用 -C / 加绝对路径会带上前导斜杠警告，这里统一用相对路径。
tar -czf "$ARCHIVE" \
  -C / \
  "${SITE_DIR#/}" \
  -C "$HOME" ".dsh/sessions" 2>/dev/null \
  || tar -czf "$ARCHIVE" -C / "${SITE_DIR#/}"

find "$BACKUP_DIR" -maxdepth 1 -name 'chat-plus-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "✓ $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
