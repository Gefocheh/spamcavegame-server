module.exports.init = api => {

  api.registerCommand({
    name: 'spawn',
    description: 'Teleport to spawn',
    handler(playerId) {
      api.players.correctPos(playerId, 0, 1, 0)

      api.players.sendMessage(playerId, 'Teleported to spawn');
    }
  });

  api.on('playerJoin', e => {
    api.players.sendMessage(e.playerId, 'Welcome!');
  });

};