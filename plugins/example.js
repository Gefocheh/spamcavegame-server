module.exports.init = api => {

  api.registerCommand({
    name: 'spawn',
    description: 'Teleport to spawn',
    handler(playerId) {
      const p = api.players.get(playerId);
      if (!p) return;

      p.x = 0;
      p.y = 5;
      p.z = 0;

      api.players.sendMessage(playerId, 'Teleported to spawn');
    }
  });

  api.on('playerJoin', e => {
    api.players.sendMessage(e.playerId, 'Welcome!');
  });

};