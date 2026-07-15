const crypto = require('crypto');
const redis = require('./redisClient');
const { DEFAULT_ARTICLES } = require('./defaultArticles');

/**
 * ホームページのコンテンツ（お薬の記事・薬剤師名）を管理するモジュール（Redisに永続化）
 */

const ARTICLE_IDS_KEY = 'site_article_ids';
const PHARMACIST_NAME_KEY = 'pharmacist_name';
const ARTICLES_SEEDED_KEY = 'articles_seeded_v1';
const DEFAULT_PHARMACIST_NAME = '担当薬剤師';

function articleKey(id) {
  return `site_article:${id}`;
}

async function getPharmacistName() {
  const name = await redis.get(PHARMACIST_NAME_KEY);
  return name || DEFAULT_PHARMACIST_NAME;
}

async function setPharmacistName(name) {
  await redis.set(PHARMACIST_NAME_KEY, name);
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

async function updateArticle(id, title, body) {
  const existing = await getArticle(id);
  if (!existing) return null;

  const updated = { ...existing, title, body, updatedAt: new Date().toISOString() };
  await redis.set(articleKey(id), JSON.stringify(updated));
  return updated;
}

async function findArticleByIdPrefix(prefix) {
  const articles = await getArticles();
  return articles.find((a) => a.id.startsWith(prefix));
}

async function deleteArticle(id) {
  await redis.del(articleKey(id));
  await redis.lrem(ARTICLE_IDS_KEY, 0, id);
}

/**
 * 初期記事（お薬の記事）を一度だけ投入する
 *
 * サーバー起動時に呼ぶ。投入済みフラグ（ARTICLES_SEEDED_KEY）を立てるので、
 * 一度投入したら再投入されず、その後は薬剤師が/adminやLINEで自由に編集・削除できる。
 * 同じタイトルの記事が既にあれば重複投入しない。
 * Redisにまだ接続できていない等で失敗した場合はフラグを立てず、次回起動時に再試行する。
 */
async function seedDefaultArticles() {
  try {
    if (await redis.get(ARTICLES_SEEDED_KEY)) return;

    const existing = await getArticles();
    const existingTitles = new Set(existing.map((a) => a.title));

    // 配列の先頭を一覧の最上部に出したいので、逆順に追加する（addArticleはlpush＝先頭に積む）
    let added = 0;
    for (let i = DEFAULT_ARTICLES.length - 1; i >= 0; i--) {
      const { title, body } = DEFAULT_ARTICLES[i];
      if (existingTitles.has(title)) continue;
      await addArticle(title, body);
      added++;
    }

    await redis.set(ARTICLES_SEEDED_KEY, '1');
    console.log(`📄 初期記事を投入しました（${added}件）`);
  } catch (err) {
    console.error('初期記事の投入に失敗しました（次回起動時に再試行します）:', err.message);
  }
}

module.exports = {
  getPharmacistName,
  setPharmacistName,
  addArticle,
  getArticles,
  getArticle,
  updateArticle,
  findArticleByIdPrefix,
  deleteArticle,
  seedDefaultArticles,
};
