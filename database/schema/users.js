const { defineTable } = require("../factory");

const users = defineTable("users", (t, dialect, core) => ({
    id: core.id(t, dialect),
    username: core.string(t, dialect, "username", 50).notNull().unique(),
    email: core.string(t, dialect, "email", 255).notNull().unique(),
    password: core.string(t, dialect, "password", 255).notNull(),
    role: core.string(t, dialect, "role", 20).default("admin"),
    createdAt: core.timestamp(t, dialect, "created_at")
}));

module.exports = { users };