module.exports.init = api => {
    function decodeArgs(args) {
        const type = args[0]
        const x = args[1]
        const y = args[2]
        const z = args[3]
        const x2 = args[4]
        const y2 = args[5]
        const z2 = args[6]



        return {type, x, y, z, x2, y2, z2}
    }
    function fill (type, x, y, z, x2, y2, z2) {
       const minY = Math.min(y, y2)
       const maxY = Math.max(y, y2)
       const minX = Math.min(x, x2)
       const maxX = Math.max(x, x2)
       const minZ = Math.min(z, z2)
       const maxZ = Math.max(z, z2)
       var amountOfBlocks = 0
        for (let yi = minY; yi < maxY; yi++ ) {
            for (let xi = minX; xi < maxX; xi++) {
                for (let zi = minZ; zi < maxZ; zi++) {
                    api.world.setBlock(xi, yi, zi, type);
                    amountOfBlocks++
                };
            };
        };
        return amountOfBlocks;
    };
    api.registerCommand({
        name: "fill",
        description: "fill the area with a specific type of blocks",
        handler(playerId, args) {
            const argObj = decodeArgs(args);
            const amountOfBlocks = fill(argObj.type, argObj.x, argObj.y, argObj.z, argObj.x2, argObj.y2, argObj.z2);
            api.players.sendMessage(playerId, "filled " + amountOfBlocks + " blocks");
        }
    });
};