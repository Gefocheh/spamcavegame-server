// plugins/nick.js
module.exports.init = (api) => {
    // Регистрируем команду /nick <новый ник>
    api.registerCommand({
        name: 'nick',
        handler: async (playerId, args) => {
            const newNick = args.join(' ').trim();
            if (!newNick) {
                api.players.sendMessage(playerId, 'Usage: /nick <new nickname>');
                return;
            }

            // Ограничим длину 16 символами и удалим лишние пробелы
            const cleaned = newNick.slice(0, 16);
            const player = api.players.get(playerId);
            if (!player) return;

            // Сохраняем старый ник для уведомления
            const oldNick = player.nickname;
            player.nickname = cleaned;

            // Сохраняем в БД (опционально)
            await api.storage.set(`nick_${playerId}`, cleaned);

            // Сообщаем всем о смене ника (сервер отправит обновлённые данные)
            api.emit('playerUpdate', { playerId, nickname: cleaned });
            api.players.sendMessage(playerId, `Nickname changed from "${oldNick}" to "${cleaned}"`);
        }
    });

    // При загрузке восстанавливаем сохранённые ники
    api.on('playerJoin', async (data) => {
        const saved = await api.storage.get(`nick_${data.playerId}`);
        if (saved) {
            const player = api.players.get(data.playerId);
            if (player) player.nickname = saved;
        }
    });
};
