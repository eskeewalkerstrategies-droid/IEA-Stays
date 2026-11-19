# Server setup: Hostinger KVM VPS with Coolify

A click-by-click checklist to get a secured server that runs everything through Coolify. Do it once, in order. Expect about 90 minutes including waits.

## Before you start

- Hostinger account with the KVM 4 plan (4 vCPU, 16 GB RAM) or an upgrade to it. Confirm the live price on Hostinger.
- A domain you control. We use `ops.<yourdomain>` for the Coolify dashboard and services. Replace `<yourdomain>` throughout.
- An SSH key pair on your laptop. Mac or Linux: `ssh-keygen -t ed25519 -C "ew-ops"` and press Enter through the prompts. Windows: use the same command in PowerShell. The public key is in `~/.ssh/id_ed25519.pub`.

## 1. Create the VPS

1. Hostinger panel, VPS, choose the KVM 4 plan.
2. Operating system: pick the **Ubuntu 24.04 with Coolify** template.
3. Set the root password (store it in the secrets record; you will disable password login below).
4. Add your SSH public key in the panel if the template asks for one.
5. Note the server IP address.

## 2. DNS

In your domain's DNS settings add:

| Type | Name | Value |
|---|---|---|
| A | `ops` | server IP |
| A | `*.ops` | server IP |

Wait until `ping ops.<yourdomain>` answers with the server IP (usually minutes, up to an hour).

## 3. First login and key-only access

```bash
ssh root@<server-ip>
```

Then on the server:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys     # paste your public key, save
chmod 600 ~/.ssh/authorized_keys
```

Open a second terminal and confirm `ssh root@<server-ip>` logs in without a password. Only then:

```bash
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh
```

Done when: `ssh -o PubkeyAuthentication=no root@<server-ip>` is refused.

## 4. Firewall

```bash
apt-get update && apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000/tcp     # Coolify dashboard, remove after step 6
ufw --force enable
ufw status
```

Also use Hostinger's panel firewall with the same four ports.

## 5. Automatic security updates and swap

```bash
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades    # choose Yes

fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf
free -h                                        # shows 4 GB swap
```

## 6. Coolify dashboard on a secure address

1. Open `http://<server-ip>:8000` and create the admin account. Use a long password and store it.
2. Settings, Configuration: set **Instance's domain** to `https://ops.<yourdomain>`. Save. Coolify issues a certificate.
3. Open `https://ops.<yourdomain>`. When it loads with a padlock:

```bash
ufw delete allow 8000/tcp
```

4. Settings, Backup: point Coolify's own backup at the storage bucket (see `backup.md`).
5. Keys & Tokens: add a deploy key, then add it to the GitHub repository (Settings, Deploy keys, read-only).

## 7. Off-site storage

Create a bucket at Backblaze B2 or Cloudflare R2 named `ew-ops-backups`. Create an application key limited to that bucket. Store the key ID and secret. In Coolify: Settings, S3 Storages, add it.

## 8. Project and environments

In Coolify create one project **ew-ops** with one environment **production**. Every service below is added here:

| Service | Type | Notes |
|---|---|---|
| postgres | Database | See `postgres.md` |
| ops-backend | Application from GitHub, Dockerfile in `backend/` | Port 8080, domain `api.ops.<yourdomain>` |
| site | Application from GitHub, static Astro in `site/` | Domain is the main website domain |
| twenty | Docker Compose | Pinned version, see `docs/twenty.md` |
| listmonk | Docker Compose | Version 6.2 |
| umami | Docker Compose | Phase 3 |

## Done when

- `https://ops.<yourdomain>` opens the Coolify dashboard with a valid certificate.
- `ssh -o PubkeyAuthentication=no root@<server-ip>` is refused.
- `ufw status` shows only 22, 80 and 443.
- `free -h` shows 4 GB swap.
