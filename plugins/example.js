module.exports.init = api => {

  api.registerCommand({
    name: 'spawn',
    description: 'Teleport to spawn',
    handler(playerId) {
      api.players.correctPos(playerId, 0, 1, 0)

      api.players.sendMessage(playerId, 'Teleported to spawn');
    }
  });
  api.registerCommand({
    name: 'tpp',
    description: 'teleport to player',
    handler(playerId, args) {
      const target = api.players.get(args);
      if (!target) {
        api.players.sendMessage(playerId, "Player not found");
      } else {
        api.players.correctPos(playerId, target.x, target.y, target.z);
        api.players.sendMessage(playerId, "Teleported to " + args);
        api.players.sendMessage(args, "Player ${playerId} teleported to you");

      }

    }
  });
  api.registerCommand({
    name: 'players',
    description: 'list all players currently connected to server',
    handler(playerId) {
      const playerObjectsArray = api.players.getAll()
      var playerList = []
      for (let i = 0; i <= playerObjectsArray.length; i ++) {
        playerList[i] = playerObjectsArray[i][0];
      }
      api.players.sendMessage("online players: " + playerList.join(", "))
    }
  })

  api.on('playerJoin', e => {
    api.players.sendMessage(e.playerId, 'Welcome!');
  });

};