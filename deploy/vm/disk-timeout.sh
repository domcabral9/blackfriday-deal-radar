#!/usr/bin/env bash
# Aumenta o timeout de disco do Linux para 30 min, de forma permanente.
#
#   sudo bash ~/deal-radar/deploy/vm/disk-timeout.sh
#
# Motivo: com o VirtualBox rodando sobre o Hyper-V, a VM chega a ficar
# minutos sem CPU. Com o timeout padrao (30 s), uma gravacao "expira" durante
# o congelamento e o ext4 remonta o disco como somente leitura. Ver
# docs/DEVELOPMENT.md, "VM congelada pelo host".

set -euo pipefail
RULE=/etc/udev/rules.d/60-vbox-disk-timeout.rules

cat > "$RULE" <<'UDEV'
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="sd[a-z]", ATTR{device/timeout}="1800"
UDEV

udevadm control --reload
udevadm trigger --subsystem-match=block --action=change
udevadm settle

for dev in /sys/block/sd*/device/timeout; do
    echo "$dev = $(cat "$dev")"
done
