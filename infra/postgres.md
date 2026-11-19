# Postgres in Coolify: one server, four databases

One Postgres 16 service with separate databases and users for Twenty, listmonk, Umami (analytics) and our own `ops` data.

Passwords use letters and numbers only. Twenty fails to connect when the password contains special characters. Generate each with:

```bash
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32; echo
```

## 1. Create the service

1. Coolify, project ew-ops, production, **+ New**, Databases, **PostgreSQL**.
2. Image: `postgres:16`. Name: `postgres`.
3. Set the superuser password (letters and numbers). Store it as `POSTGRES_SUPERUSER_PASSWORD`.
4. Do **not** make it publicly accessible. Services reach it on the internal Coolify network as host `postgres`, port 5432.
5. Start it.

## 2. Create the databases and users

Open the service's terminal in Coolify (or `docker exec -it <container> psql -U postgres`) and run, replacing each password:

```sql
CREATE USER twenty   WITH PASSWORD 'TwentyPasswordHere';
CREATE USER listmonk WITH PASSWORD 'ListmonkPasswordHere';
CREATE USER umami    WITH PASSWORD 'UmamiPasswordHere';
CREATE USER ops      WITH PASSWORD 'OpsPasswordHere';

CREATE DATABASE twenty   OWNER twenty;
CREATE DATABASE listmonk OWNER listmonk;
CREATE DATABASE umami    OWNER umami;
CREATE DATABASE ops      OWNER ops;

\c twenty
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;   -- only if the Twenty version asks for it; otherwise skip
\c ops
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Twenty's own image expects a few extensions. If its first boot complains, read the error with Claude before changing anything.

## 3. Connection strings

Store these in the secrets record and in each service's Coolify environment variables:

| Service | Variable | Value |
|---|---|---|
| ops-backend | `DATABASE_URL` | `postgres://ops:<pw>@postgres:5432/ops` |
| twenty | `PG_DATABASE_URL` | `postgres://twenty:<pw>@postgres:5432/twenty` |
| listmonk | `LISTMONK_db__host` etc. | host `postgres`, user `listmonk`, db `listmonk` |
| umami | `DATABASE_URL` | `postgresql://umami:<pw>@postgres:5432/umami` |

## 4. Backups

Coolify's database backup: open the postgres service, **Backups**, add a schedule `0 2 * * *` (02:00 server time, 07:30 India), keep 30, S3 storage `ew-ops-backups`. This dumps all databases. Our own script in `scripts/backup-postgres.sh` does the same from any machine and is what the restore test uses.

## Done when

`\l` in psql lists all four databases, and the first Coolify backup run shows **success** with a file in the bucket.
