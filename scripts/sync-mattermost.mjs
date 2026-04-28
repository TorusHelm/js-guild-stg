import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = (process.env.MATTERMOST_BASE_URL || "").replace(/\/$/, "");
const token = process.env.MATTERMOST_TOKEN;
const channelIdFromEnv = process.env.MATTERMOST_CHANNEL_ID || "";
const teamSlug = process.env.MATTERMOST_TEAM_SLUG || "";
const channelSlug = process.env.MATTERMOST_CHANNEL_SLUG || "";
const lookbackDays = Number.parseInt(process.env.MATTERMOST_LOOKBACK_DAYS || "90", 10);
const thresholdPercent = Number.parseFloat(process.env.MATTERMOST_THRESHOLD_PERCENT || "20");
const defaultPeriodDays = Number.parseInt(process.env.MATTERMOST_DEFAULT_PERIOD_DAYS || "30", 10);
const countMode = process.env.MATTERMOST_COUNT_MODE === "all_reactions" ? "all_reactions" : "unique_reactors";
const includeReplies = process.env.MATTERMOST_INCLUDE_REPLIES === "true";
const includeBots = process.env.MATTERMOST_INCLUDE_BOTS === "true";
const countAuthorReactions = process.env.MATTERMOST_COUNT_AUTHOR_REACTIONS === "true";
const outputDir = resolve(process.cwd(), "public/data");

if (!baseUrl) {
  throw new Error("MATTERMOST_BASE_URL is required");
}

if (!token) {
  throw new Error("MATTERMOST_TOKEN is required");
}

if (!channelIdFromEnv && (!teamSlug || !channelSlug)) {
  throw new Error("Provide MATTERMOST_CHANNEL_ID or MATTERMOST_TEAM_SLUG + MATTERMOST_CHANNEL_SLUG");
}

async function api(path) {
  const response = await fetch(`${baseUrl}/api/v4${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mattermost API ${path} failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function getAllPages(pathBuilder) {
  const items = [];
  let page = 0;

  for (;;) {
    const chunk = await api(pathBuilder(page));
    if (!Array.isArray(chunk) || chunk.length === 0) {
      break;
    }

    items.push(...chunk);
    if (chunk.length < 200) {
      break;
    }

    page += 1;
  }

  return items;
}

async function resolveChannel() {
  if (channelIdFromEnv) {
    const channel = await api(`/channels/${channelIdFromEnv}`);
    return channel;
  }

  const team = await api(`/teams/name/${teamSlug}`);
  const channel = await api(`/teams/${team.id}/channels/name/${channelSlug}`);
  return channel;
}

async function getPosts(channelId, since) {
  const posts = [];
  let page = 0;

  for (;;) {
    const payload = await api(
      `/channels/${channelId}/posts?page=${page}&per_page=200&since=${since}`,
    );
    const order = Array.isArray(payload.order) ? payload.order : [];
    const pagePosts = order.map((id) => payload.posts[id]).filter(Boolean);

    if (!pagePosts.length) {
      break;
    }

    posts.push(...pagePosts);
    if (pagePosts.length < 200) {
      break;
    }

    page += 1;
  }

  return posts;
}

async function main() {
  const warnings = [];
  const channel = await resolveChannel();
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const members = await getAllPages((page) => `/channels/${channel.id}/members?page=${page}&per_page=200`);
  const rawPosts = await getPosts(channel.id, since);

  const filteredPosts = rawPosts.filter((post) => {
    if (!includeReplies && post.root_id) {
      return false;
    }

    if (!post.message?.trim()) {
      return false;
    }

    return true;
  });

  const uniqueUserIds = [...new Set(filteredPosts.map((post) => post.user_id))];
  const users = {};

  for (const userId of uniqueUserIds) {
    try {
      const user = await api(`/users/${userId}`);
      users[user.id] = {
        id: user.id,
        username: user.username,
        displayName: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username,
        isBot: Boolean(user.is_bot),
      };
    } catch (error) {
      warnings.push(`Не удалось загрузить пользователя ${userId}`);
    }
  }

  const posts = [];
  for (const post of filteredPosts) {
    const user = users[post.user_id];
    if (!includeBots && user?.isBot) {
      continue;
    }

    let reactions = [];
    try {
      const response = await api(`/posts/${post.id}/reactions`);
      reactions = Array.isArray(response)
        ? response.map((reaction) => ({
            emojiName: reaction.emoji_name,
            userId: reaction.user_id,
            createAt: reaction.create_at,
          }))
        : [];
    } catch (error) {
      warnings.push(`Не удалось загрузить реакции для поста ${post.id}`);
    }

    posts.push({
      id: post.id,
      createAt: post.create_at,
      userId: post.user_id,
      message: post.message,
      replyCount: post.reply_count || 0,
      isBot: Boolean(user?.isBot),
      permalink: `${baseUrl}/${teamSlug || "main"}/pl/${post.id}`,
      reactions,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      baseUrl,
      teamSlug,
      channelSlug,
      channelId: channel.id,
    },
    settings: {
      lookbackDays,
      thresholdPercent,
      defaultPeriodDays,
      countMode,
      includeReplies,
      includeBots,
      countAuthorReactions,
    },
    channel: {
      id: channel.id,
      name: channel.name,
      displayName: channel.display_name,
      memberCount: members.length,
    },
    warnings,
    users,
    posts,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "mattermost-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Saved Mattermost report with ${posts.length} posts and ${members.length} members`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
