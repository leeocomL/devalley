import os
import re
import uuid
import json
import time
import random
import mimetypes
from collections import OrderedDict
from typing import Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles

# Windows às vezes mapeia .js para text/plain, o que quebra <script type="module">
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")

app = FastAPI(title="DevCub / Devalley - Virtual Office 2.5D")

# Paleta (Catppuccin) para o headset dos mascotes
PALETTE = ["#89B4FA", "#A6E3A1", "#F9E2AF", "#F38BA8", "#CBA6F7"]

# Espécies de mascotes suportadas
SPECIES = ("penguin", "duck", "python", "octocat")

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
NICK_RE = re.compile(r"[^A-Za-z0-9_\-]")
FILENAME_RE = re.compile(r"[^A-Za-z0-9._\- ()]")
MAX_NICK = 16
MAX_CHAT = 140
CHAT_MIN_INTERVAL = 0.35  # segundos entre mensagens do mesmo jogador
MAX_BASE64_LEN = 3_000_000  # ~2MB binário codificado em DataURL/Base64
MAX_CACHED_FILES = 25

# Área de spawn na clareira aberta (entre a fogueira e os bancos)
SPAWN_X = (-2.6, 2.6)
SPAWN_Z = (1.6, 2.8)


def sanitize_species(value: Optional[str]) -> Optional[str]:
    return value if value in SPECIES else None


def sanitize_color(value: Optional[str]) -> Optional[str]:
    if isinstance(value, str) and HEX_COLOR_RE.match(value):
        return value.upper()
    return None


def sanitize_nick(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    nick = NICK_RE.sub("", value.strip())[:MAX_NICK]
    return nick or None


def sanitize_text(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = "".join(ch for ch in value if ch.isprintable()).strip()[:MAX_CHAT]
    return text or None


def sanitize_filename(value: Optional[str]) -> str:
    if not isinstance(value, str):
        return "snippet.txt"
    clean = FILENAME_RE.sub("_", value.strip())[:64]
    return clean or "snippet.txt"


def to_float(value, default: float = 0.0) -> float:
    try:
        f = float(value)
        return f if f == f and abs(f) < 1e6 else default  # descarta NaN/inf
    except (TypeError, ValueError):
        return default


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.players: Dict[str, dict] = {}
        self.last_chat: Dict[str, float] = {}
        self.files_cache: "OrderedDict[str, dict]" = OrderedDict()
        self.latest_file_id: Optional[str] = None

    def get_file_meta(self, file_id: Optional[str]) -> Optional[dict]:
        if not file_id or file_id not in self.files_cache:
            return None
        f = self.files_cache[file_id]
        return {
            "file_id": f["file_id"],
            "filename": f["filename"],
            "fileType": f["fileType"],
            "owner": f["owner"],
            "nick": f["nick"],
        }

    async def connect(
        self,
        player_id: str,
        websocket: WebSocket,
        species: Optional[str] = None,
        color: Optional[str] = None,
        nick: Optional[str] = None,
    ):
        await websocket.accept()
        self.active_connections[player_id] = websocket

        self.players[player_id] = {
            "id": player_id,
            "nick": sanitize_nick(nick) or player_id,
            "x": round(random.uniform(*SPAWN_X), 2),
            "z": round(random.uniform(*SPAWN_Z), 2),
            "ry": 0.0,  # rotação Y (direção em que o mascote olha)
            "color": sanitize_color(color) or random.choice(PALETTE),
            "species": sanitize_species(species) or random.choice(SPECIES),
            "isSitting": False,
            "seatIndex": None,
        }

        # 1. Estado inicial para o novo jogador (inclui metadados do último arquivo no totem)
        await websocket.send_text(json.dumps({
            "type": "init",
            "your_id": player_id,
            "players": self.players,
            "latest_file": self.get_file_meta(self.latest_file_id),
        }))

        # 2. Avisa os demais
        await self.broadcast({
            "type": "player_joined",
            "player": self.players[player_id],
        }, exclude=player_id)

    def disconnect(self, player_id: str):
        self.active_connections.pop(player_id, None)
        self.players.pop(player_id, None)
        self.last_chat.pop(player_id, None)

    async def broadcast(self, message: dict, exclude: Optional[str] = None):
        msg_json = json.dumps(message)
        dead_connections = []
        for pid, connection in list(self.active_connections.items()):
            if exclude and pid == exclude:
                continue
            try:
                await connection.send_text(msg_json)
            except Exception:
                dead_connections.append(pid)

        for pid in dead_connections:
            self.disconnect(pid)

    async def update_player_position(self, player_id: str, x: float, z: float, ry: float):
        player = self.players.get(player_id)
        if not player:
            return
        player["x"] = round(x, 2)
        player["z"] = round(z, 2)
        player["ry"] = round(ry, 3)
        await self.broadcast({
            "type": "player_moved",
            "id": player_id,
            "x": player["x"],
            "z": player["z"],
            "ry": player["ry"],
        }, exclude=player_id)

    async def update_player_status(
        self,
        player_id: str,
        is_sitting: bool,
        seat_index: Optional[int],
        x: Optional[float],
        z: Optional[float],
        ry: Optional[float],
    ):
        player = self.players.get(player_id)
        if not player:
            return
        player["isSitting"] = bool(is_sitting)
        player["seatIndex"] = (
            int(seat_index)
            if is_sitting and isinstance(seat_index, int) and 0 <= seat_index < 6
            else None
        )
        if x is not None:
            player["x"] = round(to_float(x, player["x"]), 2)
        if z is not None:
            player["z"] = round(to_float(z, player["z"]), 2)
        if ry is not None:
            player["ry"] = round(to_float(ry, player["ry"]), 3)

        await self.broadcast({
            "type": "player_status_change",
            "id": player_id,
            "isSitting": player["isSitting"],
            "seatIndex": player["seatIndex"],
            "x": player["x"],
            "z": player["z"],
            "ry": player["ry"],
        })

    async def update_player_appearance(
        self,
        player_id: str,
        species: Optional[str],
        color: Optional[str],
        nick: Optional[str],
    ):
        player = self.players.get(player_id)
        if not player:
            return
        old_nick = player["nick"]
        species = sanitize_species(species)
        color = sanitize_color(color)
        nick = sanitize_nick(nick)
        if species:
            player["species"] = species
        if color:
            player["color"] = color
        if nick:
            player["nick"] = nick
        # Envia para todos (inclusive o próprio) para confirmar o estado canônico
        await self.broadcast({
            "type": "player_updated",
            "id": player_id,
            "species": player["species"],
            "color": player["color"],
            "nick": player["nick"],
            "old_nick": old_nick,
        })

    async def chat(self, player_id: str, text: Optional[str]):
        player = self.players.get(player_id)
        text = sanitize_text(text)
        if not player or not text:
            return
        now = time.monotonic()
        if now - self.last_chat.get(player_id, 0.0) < CHAT_MIN_INTERVAL:
            return
        self.last_chat[player_id] = now
        await self.broadcast({
            "type": "chat",
            "id": player_id,
            "nick": player["nick"],
            "text": text,
        })

    async def share_file(
        self,
        player_id: str,
        filename: Optional[str],
        file_type: Optional[str],
        base64_data: Optional[str],
    ):
        player = self.players.get(player_id)
        if not player or not isinstance(base64_data, str):
            return
        if not base64_data or len(base64_data) > MAX_BASE64_LEN:
            return

        file_id = "f_" + uuid.uuid4().hex[:10]
        clean_name = sanitize_filename(filename)
        clean_type = str(file_type or "text/plain")[:64]

        entry = {
            "file_id": file_id,
            "filename": clean_name,
            "fileType": clean_type,
            "base64": base64_data,
            "owner": player_id,
            "nick": player["nick"],
        }
        self.files_cache[file_id] = entry
        self.latest_file_id = file_id
        while len(self.files_cache) > MAX_CACHED_FILES:
            self.files_cache.popitem(last=False)

        # Broadcast apenas dos metadados (sem o base64 inteiro para não travar)
        await self.broadcast({
            "type": "file_shared",
            "file_id": file_id,
            "filename": clean_name,
            "fileType": clean_type,
            "owner": player_id,
            "nick": player["nick"],
        })

    async def send_file_to_player(self, player_id: str, file_id: Optional[str]):
        ws = self.active_connections.get(player_id)
        if not ws or not file_id or file_id not in self.files_cache:
            return
        await ws.send_text(json.dumps({
            "type": "file_data",
            "file": self.files_cache[file_id],
        }))


manager = ConnectionManager()


@app.get("/api/files/{file_id}")
async def get_shared_file(file_id: str):
    entry = manager.files_cache.get(file_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado no cache do Totem")
    return entry


@app.websocket("/ws/{player_id}")
async def websocket_endpoint(websocket: WebSocket, player_id: str):
    # Aparência inicial opcional: /ws/id?species=duck&color=%23FF0000&nick=ana
    qp = websocket.query_params
    await manager.connect(player_id, websocket, qp.get("species"), qp.get("color"), qp.get("nick"))
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            msg_type = payload.get("type")

            if msg_type == "move":
                await manager.update_player_position(
                    player_id,
                    to_float(payload.get("x")),
                    to_float(payload.get("z")),
                    to_float(payload.get("ry")),
                )
            elif msg_type == "player_status_change":
                await manager.update_player_status(
                    player_id,
                    bool(payload.get("isSitting")),
                    payload.get("seatIndex"),
                    payload.get("x"),
                    payload.get("z"),
                    payload.get("ry"),
                )
            elif msg_type == "customize":
                await manager.update_player_appearance(
                    player_id, payload.get("species"), payload.get("color"), payload.get("nick")
                )
            elif msg_type == "chat":
                await manager.chat(player_id, payload.get("text"))
            elif msg_type == "file_shared":
                await manager.share_file(
                    player_id,
                    payload.get("filename"),
                    payload.get("fileType") or payload.get("mimeType"),
                    payload.get("base64"),
                )
            elif msg_type == "request_file":
                await manager.send_file_to_player(player_id, payload.get("file_id"))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        left = manager.players.get(player_id, {})
        nick = left.get("nick", player_id)
        manager.disconnect(player_id)
        await manager.broadcast({"type": "player_left", "id": player_id, "nick": nick})


# Montar frontend para servir na raiz ("/")
frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
