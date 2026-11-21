#!/usr/bin/env bash
# Faz o relogio da VM conferir a hora a cada 2 min (padrao: ate 34 min).
#
#   sudo bash ~/deal-radar/deploy/vm/timesync.sh
#
# Motivo: quando o Windows desliga, o VirtualBox pode salvar a VM em vez de
# desligar. Ao restaurar de manha, o relogio volta parado na hora em que foi
# salvo (ja chegou a 11 h de atraso), e o NTP so percebe no proximo ciclo.
# Com o relogio errado, o corte de idade dos posts e o healthcheck erram.

set -euo pipefail
mkdir -p /etc/systemd/timesyncd.conf.d
cat > /etc/systemd/timesyncd.conf.d/deal-radar.conf <<'CONF'
[Time]
PollIntervalMinSec=32
PollIntervalMaxSec=120
CONF

systemctl restart systemd-timesyncd
sleep 5
timedatectl show-timesync --property=PollIntervalMaxUSec
echo "hora da VM (UTC): $(date -u '+%F %T')"
