const sharp = require('sharp');

/**
 * ぼやけた写真でも文字を読み取りやすいよう、シャープ化とコントラスト補正をかける
 * @param {Buffer} rawImage
 * @returns {Promise<string>} Base64エンコードされた画像
 */
async function enhanceImageToBase64(rawImage) {
  const enhancedImage = await sharp(rawImage)
    .resize({ width: 2000, withoutEnlargement: true })
    .normalize()
    .sharpen({ sigma: 1.5 })
    .jpeg({ quality: 90 })
    .toBuffer();

  return enhancedImage.toString('base64');
}

module.exports = { enhanceImageToBase64 };
