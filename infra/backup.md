# Backups and restore

Nightly Postgres dumps and a weekly copy of app files go to off-site storage, with 30 days kept. One restore test you can run yourself proves it works.

## What is backed up

| What | How often | Script | Kept |
|---|---|---|---|
| All four Postgres databases | Nightly 02:00 server time | `scripts/backup-postgres.sh` | 30 days |
| Docker volumes of Twenty, listmonk, Umami (uploads, config) | Weekly, Sunday 03:00 | `scripts/backup-volumes.sh` | 30 days |
| Coolify itself | Coolify's own backup setting | Coolify | 30 days |

The secrets record (passwords, keys, Twenty's `APP_SECRET`) is **not** on the server. It lives in your password manager. A backup without Twenty's encryption key cannot decrypt stored credentials, so keep both.

## One-time setup on the server

```bash
apt-get install -y rclone postgresql-client
rclone config    # new remote, name: b2, type: b2 (or s3 for R2), paste the key id and secret
rclone lsd b2:ew-ops-backups     # should list the bucket without error
```

Copy the scripts and add them to cron:

```bash
mkdir -p /opt/ew-ops/backups
cp infra/scripts/*.sh /opt/ew-ops/
chmod +x /opt/ew-ops/*.sh
cat > /etc/cron.d/ew-ops-backups <<'CRON'
0 2 * * *  root PGPASSWORD=<superuser-pw> /opt/ew-ops/backup-postgres.sh >> /var/log/ew-ops-backup.log 2>&1
0 3 * * 0  root /opt/ew-ops/backup-volumes.sh >> /var/log/ew-ops-backup.log 2>&1
CRON
```

Better: put `PGPASSWORD` in `/root/.pgpass` (`postgres-host:5432:*:postgres:<pw>`, mode 600) and drop it from the cron line.

## Restore test (run monthly)

```bash
/opt/ew-ops/restore-test.sh ops
```

The script downloads the newest `ops` dump, restores it into a throwaway database named `restore_test_ops`, counts rows in the main tables, prints them, and drops the test database. Done when it prints `RESTORE OK` and the row counts look right.

To restore for real, follow the same steps against the real database name after stopping the service that uses it. Ask Claude to walk you through it; do not improvise under pressure.

## Monitoring

The morning health check (`backend/src/jobs/health.ts`) reads `/var/log/ew-ops-backup.log` through the `BACKUP_STATUS_FILE` setting and reports the age of the last successful backup in Slack. A backup older than 36 hours shows as a warning.
