const { defineTable } = require("../factory");

const posts = defineTable("posts", (t, dialect, core) => ({
    id: core.id(t, dialect),
    title: core.string(t, dialect, "title", 255).notNull(),
    slug: core.string(t, dialect, "slug", 255).notNull().unique(),
    content: core.text(t, dialect, "content"),
    status: core.string(t, dialect, "status", 20).default("draft"), // draft / published
    createdAt: core.timestamp(t, dialect, "created_at")
}));

module.exports = { posts };