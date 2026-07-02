const crypto = require('crypto');
const redis = require('./redisClient');

/**
 * 薬剤師個人ホームページのコンテンツ（プロフィール・記事）を管理するモジュール（Redisに永続化）
 */

const PROFILE_KEY = 'site_profile';
const ARTICLE_IDS_KEY = 'site_article_ids';
const DEFAULT_PROFILE = 'プロフィールは準備中です。LINEから「プロフィール編集:本文」で設定できます。';

function articleKey(id) {
  return `site_article:${id}`;
}

async function getProfile() {
  const text = await redis.get(PROFILE_KEY);
  return text || DEFAULT_PROFILE;
}

async function setProfile(text) {
  await redis.set(PROFILE_KEY, text);
}

async function addArticle(title, body) {
  const id = crypto.randomUUID();
  const article = { id, title, body, createdAt: new Date().toISOString() };
  await redis.set(articleKey(id), JSON.stringify(article));
  await redis.lpush(ARTICLE_IDS_KEY, id);
  return article;
}

async function getArticles() {
  const ids = await redis.lrange(ARTICLE_IDS_KEY, 0, -1);
  const articles = await Promise.all(
    ids.map(async (id) => {
      const raw = await redis.get(articleKey(id));
      return raw ? JSON.parse(raw) : null;
    })
  );
  return articles.filter(Boolean);
}

async function getArticle(id) {
  const raw = await redis.get(articleKey(id));
  return raw ? JSON.parse(raw) : null;
}

async function findArticleByIdPrefix(prefix) {
  const articles = await getArticles();
  return articles.find((a) => a.id.startsWith(prefix));
}

async function deleteArticle(id) {
  await redis.del(articleKey(id));
  await redis.lrem(ARTICLE_IDS_KEY, 0, id);
}

module.exports = {
  getProfile,
  setProfile,
  addArticle,
  getArticles,
  getArticle,
  findArticleByIdPrefix,
  deleteArticle,
};
