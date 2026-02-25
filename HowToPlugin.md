# How to create plugins  
  
Plugins are simple Node.js modules placed in the `plugins/` folder.  
  
## Basic structure  
  

      
    module.exports.init = api => {  
     api.log('Plugin loaded');  
    };

----------

## Available API

### Events

    api.on('playerJoin', ({ playerId }) => {});  
    api.on('playerLeave', ({ playerId }) => {});  
    api.on('blockPlace', e => {});  
    api.on('blockBreak', e => {});  
    api.on('chat', e => {});  
    api.on('tick', () => {});

Return `false` to cancel an action.

----------

### World

    api.world.getBlock(x,y,z);  
    api.world.setBlock(x,y,z,'stone');

----------

### Players

    api.players.get(playerId);  
    api.players.getAll();  
    api.players.sendMessage(playerId, 'Hello');  
    api.players.kick(playerId, 'Reason');

----------

### Commands

    api.registerCommand({  
     name: 'spawn',  
     description: 'Teleport to spawn',  
     handler(playerId, args) {  
      const  p  =  api.players.get(playerId);  
      if (!p) return;  
      p.x =  0; p.y =  5; p.z =  0;  
     }  
    });

----------

### Storage

Each plugin has its own persistent storage.

    api.storage.get(key, defaultValue);  
    api.storage.set(key, value);  
    api.storage.all();

Data is saved automatically to `plugins/data/<plugin>.json`.

----------

## Example plugin

    module.exports.init =  api => {  
      api.on('playerJoin', e => {  
      api.players.sendMessage(e.playerId, 'Welcome!');  
     });  
    };
