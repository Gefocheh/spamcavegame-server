const knex = require('knex');

const isPostgres = process.env.DB_CLIENT === 'pg';

// Получаем конфигурацию подключения
function getConnectionConfig() {
    // Если не PostgreSQL — используем SQLite
    if (!isPostgres) {
        return { filename: process.env.DATABASE_PATH || './server.db' };
    }

    // Если задана строка подключения DATABASE_URL — используем её
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }

    // Иначе — отдельные переменные (для локальной разработки)
    return {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    };
}

const db = knex({
    client: isPostgres ? 'pg' : 'sqlite3',
    connection: getConnectionConfig(),
    useNullAsDefault: true
});

async function initDB() {
    if (!(await db.schema.hasTable('blocks'))) {
        await db.schema.createTable('blocks', t => {
            t.integer('x'); t.integer('y'); t.integer('z');
            t.string('type');
            t.primary(['x', 'y', 'z']);
        });
    }

    if (!(await db.schema.hasTable('players'))) {
        await db.schema.createTable('players', t => {
            t.string('id').primary();
            t.float('x'); t.float('y'); t.float('z');
            t.float('rotationY'); t.float('rotationX');
            t.string('nickname');
        });
    }

    if (!(await db.schema.hasTable('plugin_data'))) {
        await db.schema.createTable('plugin_data', t => {
            t.string('plugin'); t.string('key'); t.text('value');
            t.primary(['plugin', 'key']);
        });
    }
}

module.exports = { db, initDB };