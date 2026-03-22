const knex = require('knex');


function getConnectionConfig() {
    // Сначала проверяем строку подключения (Render автоматически создаёт её при привязке БД)
    const databaseUrl = process.env.INTERNAL_DATABASE_URL || process.env.DATABASE_URL;
    if (databaseUrl) {
        console.log('[DB] Используется DATABASE_URL для PostgreSQL');
        return databaseUrl;
    }

    // Если нет строки, но указан клиент PostgreSQL, используем отдельные переменные
    if (process.env.DB_CLIENT === 'pg') {
        console.log('[DB] Используются отдельные переменные для PostgreSQL');
        return {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        };
    }

    // Иначе — SQLite
    console.log('[DB] Используется SQLite');
    return {
        filename: process.env.DATABASE_PATH || './server.db'
    };
}

// Определяем, какой клиент использовать
const isPostgres = !!(
    process.env.INTERNAL_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.DB_CLIENT === 'pg'
);

// Создаём экземпляр knex
const db = knex({
    client: isPostgres ? 'pg' : 'sqlite3',
    connection: getConnectionConfig(),
    useNullAsDefault: true
});

// Инициализация таблиц (остаётся без изменений)
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
