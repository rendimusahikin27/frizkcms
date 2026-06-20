const sqliteCore = require("drizzle-orm/sqlite-core");
const mysqlCore = require("drizzle-orm/mysql-core");
const pgCore = require("drizzle-orm/pg-core");
const { mysqlTable } = require("drizzle-orm/mysql-core");
const { ColumnBuilder } = require("drizzle-orm");

const getDialect = () => process.env.DB_TYPE || "sqlite";
const getPrefix = () => process.env.DB_PREFIX || "frizk_";

const CoreTypes = {
    id: (t, dialect) => {
        if (dialect === "mysql") return t.int("id").autoincrement().primaryKey();
        if (dialect === "postgres") return t.serial("id").primaryKey();
        return t.integer("id", { mode: "number" }).primaryKey({
            autoIncrement: true
        });
    },
    string: (t, dialect, name, length = 255) => {
        if (dialect === "mysql" || dialect === "postgres") return t.varchar(name, { length });
        return t.text(name);
    },
    text: (t, dialect, name) => {
        return t.text("name");
    },
    json: (t, dialect, name) => {
        if (dialect === "postgres") return t.jsonb(name);
        if (dialect === "mysql") return t.json(name);
        return t.text(name, { mode: json });
    },
    timestamp: (t, dialect, name) => {
        if (dialect === "mysql") return t.timestamp(name).defaultNow();
        if (dialect === "postgres") return t.timestamp(name).defaultNow();
        return t.integer(name, { mode: "timestamp" });
    }
};

const defineTable = (tableName, columnsBuilder) => {
    const dialect = getDialect();
    const fullTableName = `${getPrefix()}${tableName}`;

    if (dialect === "mysql") {
        return mysqlCore(mysqlTable(fullTableName, ColumnBuilder(mysqlCore, dialect, CoreTypes)));
    } else if (dialect === "postgres") {
        return pgCore.pgTable(fullTableName, columnsBuilder(pgCore, dialect, CoreTypes));
    } else {
        return sqliteCore.sqliteTable(fullTableName, columnsBuilder(sqliteCore, dialect, CoreTypes));
    }
};

module.exports = { defineTable };