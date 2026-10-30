import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { newRoom, addPlayer, startRound, roomView, move, tick, touch, requireThat, declarePifado, reenter, claimDiscard, canStartNextRound, declineReentry, decideRound, claimKnock } from './assets/game.js';
import { setBots, stepBots } from './assets/bots.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, 'assets');
const PORT = process.env.PORT || 8787;

const users = new Map();
const tokens = new Map();
const rooms = new Map();

const DB_FILE = path.join(__dirname, 'users-data.json');
function loadUsers() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const u of data) {
        users.set(u.id, u);
      }
      console.log(`[DB] Carregou ${users.size} contas de usuários salvos.`);
    }
  } catch (err) {
    console.error('[DB] Erro ao carregar users-data.json:', err);
  }
}
function saveUsers() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify([...users.values()], null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Erro ao salvar users-data.json:', err);
  }
}
loadUsers();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

function getAuthUser(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const userId = tokens.get(token);
  return userId ? users.get(userId) : null;
}

// Background tick & bots loop
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (r.status === 'finished') continue;
    tick(r, now);
    stepBots(r, now);
  }
}, 500);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const apiPath = pathname.slice(4);
    const body = req.method === 'POST' ? await parseBody(req) : {};

    try {
      if (apiPath === '/register' && req.method === 'POST') {
        const name = String(body.name || '').trim();
        const password = String(body.password || '');
        if (name.length < 3 || name.length > 24) throw new Error('Nome deve ter de 3 a 24 caracteres.');
        if (password.length < 4) throw new Error('Senha deve ter pelo menos 4 caracteres.');
        if ([...users.values()].some(u => u.name.toLowerCase() === name.toLowerCase())) {
          throw new Error('Este nome já está em uso.');
        }
        const id = 'user-' + Math.random().toString(36).slice(2, 10);
        const user = { id, name, password, avatar: Math.floor(Math.random() * 6), wins: 0, chips: 1000 };
        users.set(id, user);
        saveUsers();
        const token = 'tok-' + Math.random().toString(36).slice(2, 16);
        tokens.set(token, id);
        return sendJson(res, 200, { token, user: { id: user.id, name: user.name, avatar: user.avatar, wins: user.wins, chips: user.chips } });
      }

      if (apiPath === '/login' && req.method === 'POST') {
        const name = String(body.name || '').trim();
        const password = String(body.password || '');
        const user = [...users.values()].find(u => u.name.toLowerCase() === name.toLowerCase() && u.password === password);
        if (!user) throw new Error('Nome ou senha incorretos.');
        const token = 'tok-' + Math.random().toString(36).slice(2, 16);
        tokens.set(token, user.id);
        return sendJson(res, 200, { token, user: { id: user.id, name: user.name, avatar: user.avatar, wins: user.wins, chips: user.chips } });
      }

      const currentUser = getAuthUser(req);
      if (!currentUser) return sendJson(res, 401, { error: 'Não autenticado.' });

      if (apiPath === '/logout' && req.method === 'POST') {
        return sendJson(res, 200, { ok: true });
      }

      if (apiPath === '/lobby' && req.method === 'GET') {
        const activeRooms = [...rooms.values()].filter(r => !r.private && r.status === 'waiting');
        const myRooms = [...rooms.values()].filter(r => r.players.some(p => p.id === currentUser.id) && r.status !== 'finished');
        return sendJson(res, 200, {
          user: { id: currentUser.id, name: currentUser.name, avatar: currentUser.avatar, wins: currentUser.wins, chips: currentUser.chips },
          rooms: activeRooms.map(r => ({
            id: r.id,
            name: r.name,
            code: r.code,
            count: r.players.length,
            capacity: r.capacity,
            points: r.points,
            buyIn: r.buyIn,
            practice: r.practice,
            bots: r.players.filter(p => p.bot).length
          })),
          myRooms: myRooms.map(r => ({
            id: r.id,
            name: r.name,
            code: r.code,
            status: r.status,
            practice: r.practice
          }))
        });
      }

      if (apiPath === '/rooms' && req.method === 'POST') {
        const capacity = Math.min(10, Math.max(2, Number(body.capacity || 4)));
        const points = Number(body.points || 10);
        const buyIn = Number(body.buyIn || 10);
        const isPrivate = !!body.private;
        const name = String(body.name || `Sala de ${currentUser.name}`).slice(0, 48);

        const r = newRoom(currentUser.id, { name, capacity, points, buyIn, private: isPrivate });
        r.practice = false; // Salas online NUNCA são treino
        addPlayer(r, { id: currentUser.id, name: currentUser.name, avatar: currentUser.avatar });
        // SEM BOTS: Salas online são 100% pessoas reais

        rooms.set(r.id, r);
        return sendJson(res, 200, roomView(r, currentUser.id));
      }

      if (apiPath === '/practice' && req.method === 'POST') {
        const capacity = Math.min(10, Math.max(2, Number(body.capacity || 4)));
        const points = Number(body.points || 10);
        const buyIn = Number(body.buyIn || 10);
        const r = newRoom(currentUser.id, { name: 'Treino Cachetão', capacity, points, buyIn, private: true });
        r.practice = true;
        addPlayer(r, { id: currentUser.id, name: currentUser.name, avatar: currentUser.avatar });
        setBots(r, capacity - 1);
        startRound(r);
        rooms.set(r.id, r);
        return sendJson(res, 200, roomView(r, currentUser.id));
      }

      if (apiPath === '/join' && req.method === 'POST') {
        const code = String(body.code || '').trim().toUpperCase();
        const r = [...rooms.values()].find(x => x.code === code);
        if (!r) throw new Error('Sala não encontrada.');
        if (r.players.length >= r.capacity && !r.players.some(p => p.id === currentUser.id)) {
          throw new Error('Sala cheia.');
        }
        if (!r.players.some(p => p.id === currentUser.id)) {
          addPlayer(r, { id: currentUser.id, name: currentUser.name, avatar: currentUser.avatar });
        }
        return sendJson(res, 200, roomView(r, currentUser.id));
      }

      const match = apiPath.match(/^\/?rooms\/([^/]+)(?:\/([\w-]+))?$/);
      if (match) {
        const roomId = match[1];
        const action = match[2];
        const r = rooms.get(roomId);
        if (!r) throw new Error('Sala não encontrada.');

        if (!action) {
          return sendJson(res, 200, roomView(r, currentUser.id));
        }

        const uid = currentUser.id;
        if (action === 'decide') decideRound(r, uid, body.choice);
        else if (action === 'claim-knock') claimKnock(r, uid, body.cardId, body.mode);
        else if (action === 'pifado') declarePifado(r, uid);
        else if (action === 'claim') claimDiscard(r, uid, body.card);
        else if (action === 'reenter') reenter(r, uid);
        else if (action === 'declineReentry') declineReentry(r, uid);
        else if (action === 'move') move(r, uid, body);
        else if (action === 'start') {
          requireThat(r.status === 'waiting', 'A partida já começou.');
          startRound(r);
        }
        else if (action === 'next') {
          requireThat(r.status === 'roundEnd', 'Aguarde o fim da rodada.');
          requireThat(canStartNextRound(r), 'Aguarde a janela de reentrada.');
          startRound(r);
        }
        else if (action === 'bots') {
          if (r.practice) {
            setBots(r, body.count);
          } else {
            throw new Error('Salas online são apenas para pessoas reais (sem bots).');
          }
        }
        else if (action === 'chat') {
          const text = String(body.text || '').trim().slice(0, 160);
          if (text) {
            r.messages.push({ name: currentUser.name, text, at: Date.now() });
            r.messages = r.messages.slice(-30);
            touch(r);
          }
        }
        else if (action === 'leave') {
          r.players = r.players.filter(p => p.id !== uid);
          if (r.players.filter(p => !p.bot).length === 0) rooms.delete(r.id);
          return sendJson(res, 200, { ok: true });
        }
        else if (action === 'resign') {
          const me = r.players.find(p => p.id === uid);
          if (me) me.points = 0;
          const active = r.players.filter(p => p.points > 0);
          if (active.length <= 1) {
            r.status = 'finished';
            r.winner = active[0]?.id || null;
            if (r.winner && r.pot > 0) {
              const champ = r.players.find(p => p.id === r.winner);
              if (champ) champ.chips = (champ.chips || 0) + r.pot;
            }
          }
          touch(r);
        }

        return sendJson(res, 200, roomView(r, currentUser.id));
      }

      sendJson(res, 404, { error: 'Endpoint não encontrado.' });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Serve static assets
  let filePath = path.join(ASSETS_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(` Servidor Cachetão CM Online rodando na porta ${PORT}!`);
  console.log(` Acesse localmente: http://localhost:${PORT}`);
  console.log(` Na rede Wi-Fi / IP local: http://<seu-ip>:${PORT}`);
  console.log(` Regras do Cachetão:`);
  console.log(`  - 2 a 10 jogadores`);
  console.log(`  - 4 coringas (vira define valor seguinte na mesma cor)`);
  console.log(`  - Decisão: Jogar ou Correr (-1 pt); com 1 pt obrigatório jogar`);
  console.log(`  - BATI (9 cartas) e BATI DE 10 (2 pts de penalidade)`);
  console.log(`  - Pegar descarte fora da vez com BATI / BATI DE 10`);
  console.log(`  - Salas pagas com buy-in e pote para o campeão`);
  console.log(`======================================================\n`);
});
