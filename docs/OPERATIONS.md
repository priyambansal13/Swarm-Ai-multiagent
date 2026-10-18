# SwarmAI — operations cheat sheet

Commands to check and run the production server. Replace the placeholders:

| Placeholder | Meaning | Example |
|---|---|---|
| `<domain>` | the server's public address | `my-swarm.duckdns.org` |
| `<server-ip>` | the VM's public IP | `203.0.113.10` |
| `<user>` | SSH login | `opc` (Oracle Linux) or `ubuntu` (Ubuntu) |

How it fits together: [DEPLOYMENT-ARCHITECTURE.md](DEPLOYMENT-ARCHITECTURE.md) · setting it up:
[DEPLOY-ORACLE.md](DEPLOY-ORACLE.md).

---

## 1. Quick health check (from your computer, no login)
```bash
curl -s -o /dev/null -w "web: %{http_code}\n" https://<domain>/          # 200
curl -s https://<domain>/api/health                                     # {"status":"ok","database":"up",...}
curl -s https://<domain>/api/auth/signup-policy                         # {"mode":"invite","open":false} on a server
dig +short <domain>                                                     # must print <server-ip>
echo | openssl s_client -connect <domain>:443 -servername <domain> 2>/dev/null \
  | openssl x509 -noout -enddate                                        # certificate expiry (renewed automatically)
```

## 2. One-liners over SSH (from your computer)
```bash
ssh <user>@<server-ip> 'cd swarm-ai && ./setup.sh status'      # services, integrations, n8n workflows
ssh <user>@<server-ip> 'cd swarm-ai && docker compose ps'      # containers + healthy / unhealthy
ssh <user>@<server-ip> 'docker stats --no-stream'              # memory / CPU per container
ssh <user>@<server-ip> 'free -h; df -h /'                      # server memory and disk
ssh <user>@<server-ip> 'tail -5 ~/swarm-backups/backup.log; ls -lt ~/swarm-backups | head -5'   # latest backups
ssh <user>@<server-ip> 'journalctl -t duckdns --since "-1 day"'                                  # DuckDNS failures (empty = fine)
```

## 3. On the server (`ssh <user>@<server-ip>`, then `cd swarm-ai`)
| Check / task | Command |
|---|---|
| Everything at once | `./setup.sh status` |
| Containers and health | `docker compose ps` |
| Live logs | `docker compose logs -f brain` (or `web`, `n8n`, `caddy`, `postgres`) |
| Recent errors only | `docker compose logs --since 1h brain \| grep -iE "error\|exception"` |
| n8n runs in the last hour | see [below](#n8n-runs-by-workflow) |
| Which code is running | `git log --oneline -1` |
| Restart one part | `docker compose restart brain` |
| Restart everything | `docker compose up -d` |
| Update to the latest `main` | `git pull && ./setup.sh deploy` |
| Re-register Telegram / WhatsApp webhooks | `./setup.sh n8n` |
| Back up now | `infra/backup.sh` |
| Restore the app database | `gunzip -c ~/swarm-backups/swarm-<date>.sql.gz \| docker exec -i swarm-db psql -U swarm -d swarm` |
| Free disk (build cache) when `df -h /` > 80 % | `docker builder prune -f` |
| Server memory / disk | `free -h` · `df -h /` |

### n8n runs by workflow
```bash
docker exec swarm-db psql -U swarm -d n8n -c "select w.name, e.status, count(*) from execution_entity e
  join workflow_entity w on w.id = e.\"workflowId\" where e.\"startedAt\" > now() - interval '1 hour' group by 1, 2 order by 1"
```
Healthy: the *Scheduler* runs about 60 times an hour, all `success`.

## 4. n8n editor (private)
```bash
ssh -L 5678:localhost:5678 <user>@<server-ip>      # keep this open, then browse http://localhost:5678
```
The first visit asks you to create the n8n owner account. Workflows are regenerated on every deploy, so change them in
`n8n/build-workflows.mjs`, not in the editor.

## 5. Telegram webhook (from the `swarm-ai` folder on your computer)
```bash
T=$(grep '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2)
curl -s "https://api.telegram.org/bot$T/getWebhookInfo" | python3 -m json.tool | grep -E '"url"|pending|last_error'
```
`url` must start with `https://<domain>/webhook/`; `pending_update_count` should be 0 and there should be no
`last_error_message`. If the URL points somewhere else (e.g. a laptop tunnel), run `./setup.sh n8n` on the server.

## 6. What "good" looks like
| Check | Expected |
|---|---|
| `docker compose ps` | 5 containers up; `swarm-brain`, `swarm-web`, `swarm-db` show `(healthy)` |
| `/api/health` | `"status":"ok"`, `"database":"up"` |
| `./setup.sh status` | all ✔, 5 n8n workflows active |
| `docker stats` | total well under the VM's memory (≈ 0.8 GB idle) |
| `df -h /` | below ~80 % |
| `~/swarm-backups/backup.log` | a `backup ok` line from last night |
| `journalctl -t duckdns` | no entries |

## 7. When something is wrong
| Symptom | First thing to try |
|---|---|
| Site down / 502 | `docker compose ps` → `docker compose up -d` → `docker compose logs --tail 50 caddy brain web` |
| A container shows `unhealthy` | `docker compose logs --tail 100 <name>` → `docker compose restart <name>` |
| Telegram / WhatsApp silent | webhook check (§5) → `./setup.sh n8n` → `docker compose logs --tail 100 n8n` |
| Certificate error | `docker compose logs caddy`; check ports 80/443 are open and `dig` points at the server |
| Backup alert on Telegram | `tail -20 ~/swarm-backups/backup.log`; `df -h /`; run `infra/backup.sh` by hand |
| Disk full | `docker builder prune -f`; `docker image prune -f` |
| Out of memory | `docker stats --no-stream`; `free -h`; restart the largest container |
