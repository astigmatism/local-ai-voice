# Security

This is a local appliance, not an internet-facing SaaS service. Treat it like an internal infrastructure component.

## Network exposure

Recommended:

- Bind the gateway only on a trusted LAN, VPN, or reverse proxy.
- Keep worker ports on `127.0.0.1`.
- Do not expose `127.0.0.1:8001` or `127.0.0.1:8002` through firewall/NAT.
- Use UFW to restrict port `8000` to trusted subnets.

Example:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow from 192.168.0.0/16 to any port 8000 proto tcp
sudo ufw enable
```

## Authentication

The gateway includes a Basic Auth placeholder:

```text
AUTH_ENABLED=true
BASIC_AUTH_USERNAME=admin
BASIC_AUTH_PASSWORD=<long-random-password>
```

For stronger production controls, put the appliance behind:

- WireGuard/Tailscale/ZeroTier VPN.
- Reverse proxy with SSO.
- mTLS between an orchestrator and gateway.

## Upload handling

Implemented safeguards:

- `MAX_UPLOAD_BYTES` defaults to 100 MiB.
- Gateway validates common audio content types.
- File names are sanitized and stored with random IDs.
- Path traversal is rejected for saved uploads.
- Workers are private and only receive gateway-forwarded data.

Operational guidance:

- Keep reference clips consented and local.
- Periodically delete old uploads/outputs.
- Do not use generated voice output for deception or impersonation.

## Secrets

Do not commit:

- `.env`
- `local-ai-voice.env`
- API keys
- model registry tokens
- private voice/reference clips

`.env.example` and `systemd/local-ai-voice.env.example` contain only placeholders.

## Shell safety

Gateway code uses `execFile` with fixed commands for `nvidia-smi`, `df`, `ss`, and optional `systemctl`. It does not shell-interpolate user-provided input. Systemd service names are validated before use.

## CORS

`CORS_ORIGIN` defaults to the gateway origin. Avoid `*`. If you front the portal with a reverse proxy, set `CORS_ORIGIN` to that exact origin.

## Linux hardening

Systemd units include:

- Dedicated service user.
- `NoNewPrivileges=true`.
- `PrivateTmp=true`.
- `ProtectSystem=full`.
- `ReadWritePaths=/opt/local-ai-voice`.
- Worker membership in `video` and `render` groups for GPU access.

Do not over-harden with device isolation unless you verify `/dev/nvidia*` remains accessible.

## Backups and data classification

Reference voices can be sensitive biometric-adjacent data. Back them up only to trusted encrypted storage and document retention policies.
