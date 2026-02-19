const { notarize } = require('@electron/notarize');
const path = require('path');
const fs = require('fs');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  if (!process.env.APPLE_API_KEY_ID) {
    console.log('Skipping notarization: no APPLE_API_KEY_ID set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  // Write the .p8 key to a temp file
  const keyPath = path.join(require('os').tmpdir(), `AuthKey_${process.env.APPLE_API_KEY_ID}.p8`);
  fs.writeFileSync(keyPath, process.env.APPLE_API_KEY_P8, { mode: 0o600 });

  console.log(`Notarizing ${appPath}...`);

  try {
    await notarize({
      appPath,
      appleApiKey: keyPath,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_KEY_ISSUER,
    });
    console.log('Notarization complete!');
  } finally {
    // Always clean up the key file
    fs.unlinkSync(keyPath);
  }
};