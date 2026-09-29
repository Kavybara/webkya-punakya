import os
import shlex
import sys
import time

import paramiko


def password():
    for candidate in (".env", "apps/dashboard/.env"):
        if not os.path.exists(candidate):
            continue
        values = {}
        with open(candidate, encoding="utf-8") as handle:
            for raw in handle:
                line = raw.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    values[key.strip()] = value.strip().strip('"').strip("'")
        for key in ("VPS_PASSWORD", "OWNER_PASSWORD"):
            if values.get(key):
                return values[key]
    raise RuntimeError("VPS password is not configured locally")


archive = os.path.abspath(sys.argv[1])
remote_archive = f"/tmp/kavya-notifications-{int(time.time())}.tar.gz"
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("178.83.188.210", username="root", password=password(), timeout=20)
with client.open_sftp() as sftp:
    sftp.put(archive, remote_archive)

paths = [
    "apps/dashboard/dist",
    "apps/dashboard/src/components/console/ConsoleShell.tsx",
    "apps/dashboard/src/components/console/console.css",
    "apps/dashboard/src/components/console/ownerNotifications.ts",
]
stamp = time.strftime("%Y%m%d-%H%M%S")
command = (
    "set -eu; cd /opt/kavya; mkdir -p deploy-backups; "
    f"tar -czf deploy-backups/notifications-{stamp}.tar.gz "
    + " ".join(shlex.quote(path) for path in paths if path != "apps/dashboard/src/components/console/ownerNotifications.ts")
    + f"; tar -xzf {shlex.quote(remote_archive)} -C /opt/kavya; "
    "pm2 restart kavya --update-env >/dev/null; sleep 3; "
    "curl -fsS http://127.0.0.1:2051/api/health >/dev/null; "
    f"rm -f {shlex.quote(remote_archive)}; printf 'deploy_ok\\n'"
)
_, stdout, stderr = client.exec_command(command, timeout=90)
status = stdout.channel.recv_exit_status()
print(stdout.read().decode("utf-8", "replace"), end="")
error = stderr.read().decode("utf-8", "replace")
if error:
    print(error, file=sys.stderr)
client.close()
raise SystemExit(status)
