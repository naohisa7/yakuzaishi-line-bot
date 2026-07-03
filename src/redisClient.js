const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);

// リスナーを付けないとRedis接続エラー時にプロセスごと落ちてしまうため、
// ここでエラーを受け止めてログに残すだけにする
redis.on('error', (err) => {
  console.error('[Redis] 接続エラー:', err.message);
});

module.exports = redis;
