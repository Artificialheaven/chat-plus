# 部署与运维

本项目的线上形态：静态站点 `syd.eastcloud.top`（nginx + Let's Encrypt）与 DSH 服务（`:3081`）同机部署。

## 一次性准备

```bash
# 1. 站点目录
sudo mkdir -p /var/www/syd.eastcloud.top
sudo chown -R www-data:www-data /var/www/syd.eastcloud.top

# 2. nginx 站点
sudo cp scripts/nginx/syd.eastcloud.top.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/syd.eastcloud.top.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 3. 证书（HTTP-01，需 80 端口可达、DNS 已指向本机）
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d syd.eastcloud.top --redirect

# 4. DSH 服务
sudo cp scripts/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-web dsh-port3081

# 5. 定时备份
( crontab -l 2>/dev/null; echo "0 4 * * * $PWD/scripts/backup.sh" ) | crontab -
```

## 日常发布

```bash
./scripts/deploy.sh                 # 安装依赖 → 类型检查 → 测试 → 构建 → 发布 → reload nginx
SITE_DIR=/var/www/other ./scripts/deploy.sh
RELOAD_NGINX=0 ./scripts/deploy.sh  # 只发文件
```

脚本用 `rsync --delete` 同步 `dist/`，因此**站点目录里不要放手工文件**。

## 备份

```bash
./scripts/backup.sh                 # 写入 ~/backups，保留 7 天
KEEP_DAYS=30 BACKUP_DIR=/data/bak ./scripts/backup.sh
```

包含站点文件与 `~/.dsh/sessions`（会话历史）。**不包含** API Key：`~/.dsh/.credentials.yaml` 与浏览器 localStorage 里的密钥需要单独保管。

## 端口与访问方式

| 入口 | 用途 | 守护 |
| --- | --- | --- |
| `:22` | SSH | systemd |
| `:443` / `:80` | 静态站点（HTTP 自动跳 HTTPS） | nginx |
| `:3081` | DSH Web（需要 URL 里的 token） | `dsh-port3081.service` |
| `127.0.0.1:3080` | DSH 本体，仅回环 | `dsh-web.service` |

DSH 的 token 在服务启动时随机生成并打进 journal，取法：

```bash
sudo journalctl -u dsh-web --since '-5 min' | grep -o 'token=[A-Za-z0-9_-]*' | tail -1
```

## 排障

| 现象 | 检查 |
| --- | --- |
| 站点 404/旧版本 | `ls /var/www/...`；确认部署脚本跑的是同一个 `SITE_DIR` |
| 证书过期 | `sudo certbot renew --dry-run`；`systemctl status certbot.timer` |
| DSH 打不开 | `systemctl status dsh-web dsh-port3081`；`ss -ltn \| grep -E ':(3080\|3081)'` |
| 重启 DSH 后 token 失效 | 重新取 token，见上 |
| 磁盘满 | `df -h /`；`du -xh -d1 / \| sort -rh \| head`；清 `~/.npm/_npx` 与 apt 缓存 |
