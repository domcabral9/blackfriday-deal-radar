"""Estado de recuperacao por canal, gravado no volume /data.

Duas informacoes por canal:
  watermark  ID ate onde a reconciliacao ja varreu o canal. So a
             reconciliacao avanca esse valor, depois de processar o intervalo
             inteiro. Se o ao vivo avancasse, um post novo chegando logo apos
             uma reconexao empurraria a marca para cima e os posts perdidos
             no intervalo ficariam abaixo dela, esquecidos.
  seen       IDs recentes ja entregues (ao vivo ou reconciliados), para a
             reconciliacao nao repetir o que o ao vivo ja mandou.

O arquivo sobrevive a reboot, VM restaurada de "saved" e recriacao do
container.
"""

import json
import os
import tempfile

from . import config

PATH = os.path.join(config.DATA_DIR, "cursor.json")
SEEN_KEEP = 1000


class Cursor:
    def __init__(self) -> None:
        self.watermark: dict[int, int] = {}
        self.seen: dict[int, set[int]] = {}
        try:
            with open(PATH, encoding="utf-8") as f:
                raw = json.load(f)
            for k, v in raw.items():
                self.watermark[int(k)] = int(v["watermark"])
                self.seen[int(k)] = set(v.get("seen", []))
        except (FileNotFoundError, ValueError, KeyError, TypeError):
            pass

    def is_seen(self, channel: int, msg_id: int) -> bool:
        return msg_id in self.seen.get(channel, set())

    def mark_seen(self, channel: int, msg_id: int) -> None:
        ids = self.seen.setdefault(channel, set())
        ids.add(msg_id)
        if len(ids) > SEEN_KEEP:
            for old in sorted(ids)[: len(ids) - SEEN_KEEP]:
                ids.discard(old)

    def save(self) -> None:
        data = {
            str(ch): {"watermark": wm, "seen": sorted(self.seen.get(ch, set()))}
            for ch, wm in self.watermark.items()
        }
        # Escrita atomica: um reset da VM no meio da gravacao nao corrompe o arquivo
        fd, tmp = tempfile.mkstemp(dir=config.DATA_DIR, prefix=".cursor-")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, PATH)
