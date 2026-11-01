# 🌄 Devalley 

> Um escritório virtual multiplayer 2.5D (estilo HD-2D / diorama com câmera orbital e micro-voxels) focado em desenvolvedores e co-working de estudos, construído com **Three.js** e **FastAPI**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Three.js](https://img.shields.io/badge/Three.js-r128-black.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg)

---

## 🚀 Funcionalidades

- **Motor Procedural Micro-Voxel:** Terreno esculpido com ~20.000 micro-voxels usando `THREE.InstancedMesh` para renderização fluida a 60 FPS.
- **Mascotes Dev Chibi 3D:** 4 avatares temáticos voxel com fones gamer personalizáveis:
  - 🐧 **Linux Tux** (Penguin)
  - 🦆 **Rubber Duck** (Debug Duck)
  - 🐍 **Python Snake**
  - 🐙 **Octocat**
- **Multiplayer em Tempo Real:** Sincronização de posições, rotação, tags de nome e status via WebSocket.
- **Estações de Trabalho & Status:** 6 bancadas com sistema de proximidade interativo (`[E]` para sentar, alternando status para `[nick | 💻 CODING]` e exibindo partículas de código).
- **Data Firepit & Compartilhamento de Arquivos:**
  - **File & Print Drop:** Arraste arquivos ou use `Ctrl+V` para subir prints/código diretamente para a sala com holograma 3D e modal de inspeção TUI retro.
- **Iluminação PBR & Ciclo Dinâmico:** Iluminação Golden Hour, sombras suaves (`PCFSoftShadowMap`) e suporte a comandos de tempo (`/time sunset`, `/time night`, `/time noon`).
- **Terminal TUI Integrado:** HUD retro terminal para chat, comandos e inspeção de payloads.

---

## 🛠️ Como Executar Localmente

### Pré-requisitos
- Python 3.9+ instalado

### 1. Clonar o repositório
```bash
git clone https://github.com/leeocomL/devalley.git
cd devalley
```

### 2. Instalar dependências
```bash
pip install -r backend/requirements.txt
```

### 3. Iniciar o servidor
```bash
python backend/server.py
```
ou via Uvicorn:
```bash
uvicorn backend.server:app --reload --port 8000
```

### 4. Acessar
Abra no navegador: [http://localhost:8000](http://localhost:8000)

---

## 🎮 Controles

- **W, A, S, D** ou **Setas:** Mover o mascote
- **Botão Esquerdo + Arrastar:** Girar câmera orbital
- **Scroll do Mouse:** Zoom
- **E:** Sentar / Levantar da bancada de trabalho
- **F:** Inspecionar arquivo ativo no Data Firepit
- **Tab / Enter:** Abrir / Focar no terminal TUI
- **Ctrl+V / Drag & Drop:** Compartilhar prints e arquivos de código na fogueira
- **Comandos do Terminal:**
  - `/nick <nome>`: Altera seu apelido
  - `/avatar <tux|duck|python|octocat>`: Troca de mascote
  - `/time <sunset|night|noon>`: Altera o horário e atmosfera

---

## 📄 Licença
Distribuído sob a licença MIT.
