// db.js
const knex = require('knex');

function getConnectionConfig() {
    // First check connection string (Render automatically creates it when attaching a DB)
    const databaseUrl = process.env.INTERNAL_DATABASE_URL || process.env.DATABASE_URL;
    if (databaseUrl) {
        console.log('[DB] Using DATABASE_URL for PostgreSQL');
        return databaseUrl;
    }

    // If no string but PostgreSQL client is specified, use individual variables
    if (process.env.DB_CLIENT === 'pg') {
        console.log('[DB] Using individual variables for PostgreSQL');
        return {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        };
    }

    // Otherwise — SQLite
    console.log('[DB] Using SQLite');
    return {
        filename: process.env.DATABASE_PATH || './server.db'
    };
}

// Determine which client to use
const isPostgres = !!(
    process.env.INTERNAL_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.DB_CLIENT === 'pg'
);

// Create knex instance
const db = knex({
    client: isPostgres ? 'pg' : 'sqlite3',
    connection: getConnectionConfig(),
    useNullAsDefault: true
});

// Initialize tables
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

    // New table for saved strings
    if (!(await db.schema.hasTable('saved_strings'))) {
        await db.schema.createTable('saved_strings', t => {
            t.increments('id');
            t.string('value');
            t.timestamp('created_at').defaultTo(db.fn.now());
        });
    }
}

module.exports = { db, initDB };
