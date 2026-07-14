const sharp = require('sharp');

/**
 * 患者さんがスマホで撮った写真（ぼやけ・暗さ・照明ムラ・縦向き）でも
 * AIが薬品名を読み取りやすいように補正する
 *
 * ここでの処理の狙い（過酷な劣化画像でのベンチマークに基づく）：
 * - EXIFの向きを反映する。これが無いと縦向きで撮った写真が横倒しのままAIに渡り、
 *   薬品名の誤読や「実在しない薬の捏造」が起きる（実測で確認済み・最重要）
 * - 長辺を1568pxに揃える。Claudeは内部で約1568pxに縮小するため、これより大きくても
 *   意味がなく、逆に二重の縮小で細部が失われる
 * - 小さすぎる写真は拡大しておく。文字がつぶれたままだと読み取れないため
 * - CLAHE（局所コントラスト補正）で、白飛び・影のある写真の文字を浮かび上がらせる
 */

// Claudeが画像を内部で縮小する上限。ここに合わせておくと二重縮小によるボケを避けられる
const TARGET_LONG_EDGE = 1568;
// これより小さい写真は文字がつぶれやすいので拡大する
const MIN_LONG_EDGE = 1400;

/**
 * 写真を補正してBase64にする
 * @param {Buffer} rawImage
 * @returns {Promise<string>} Base64エンコードされたJPEG
 */
async function enhanceImageToBase64(rawImage) {
  const metadata = await sharp(rawImage).metadata();
  // 長辺はEXIFで縦横が入れ替わっても変わらないので、そのまま使ってよい
  const longEdge = Math.max(metadata.width || 0, metadata.height || 0);

  // 小さい写真は文字がつぶれているので拡大する（それ以外は拡大しない）
  const shouldEnlarge = longEdge > 0 && longEdge < MIN_LONG_EDGE;

  const enhanced = await sharp(rawImage)
    // 引数なしのrotate()でEXIFの向きを反映する。これが無いと縦向きの写真が横倒しのまま渡る
    .rotate()
    // fit:'inside'は縦横比を保ち、絶対に切り抜かない。
    // ここでfitを省くと既定のcoverになり、薬品名が画像の外に切り落とされる（実際に起きた不具合）
    .resize({
      width: TARGET_LONG_EDGE,
      height: TARGET_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: !shouldEnlarge,
      kernel: 'lanczos3',
    })
    .clahe({ width: 32, height: 32, maxSlope: 3 }) // 白飛び・影のムラを均して文字を出す
    .sharpen({ sigma: 1.2, m1: 0.6, m2: 2.5 }) // 輪郭を立てる（強すぎるとノイズが増える）
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();

  return enhanced.toString('base64');
}

module.exports = { enhanceImageToBase64 };
