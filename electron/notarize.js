const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  // Skip if no Apple credentials (e.g. unsigned CI builds)
  if (!process.env.APPLE_ID) {
    console.log('Skipping notarization: no APPLE_ID set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
