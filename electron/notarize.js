const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  if (!process.env.APPLE_API_KEY || !process.env.APPLE_API_KEY_ID || !process.env.APPLE_API_KEY_ISSUER) {
    console.log('Skipping notarization: APPLE_API_KEY, APPLE_API_KEY_ID, or APPLE_API_KEY_ISSUER not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleApiKey: process.env.APPLE_API_KEY,
    appleApiKeyId: process.env.APPLE_API_KEY_ID,
    appleApiIssuer: process.env.APPLE_API_KEY_ISSUER,
  });

  console.log('Notarization complete!');
};
