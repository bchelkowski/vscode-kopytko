/**
 * Valid BrightScript component names for CreateObject() validation.
 *
 * Kept in sync with the extension's src/server/brightscript/components.ts.
 */

const COMPONENT_NAMES: string[] = [
  'roAppInfo', 'roAppManager', 'roAppMemoryMonitor', 'roArray', 'roAssociativeArray',
  'roAudioGuide', 'roAudioMetadata', 'roAudioPlayer', 'roAudioResource',
  'roBitmap', 'roBoolean', 'roByteArray',
  'roCECStatus', 'roChannelStore', 'roCompositor',
  'roDataGramSocket', 'roDateTime', 'roDeviceCrypto', 'roDeviceInfo', 'roDouble',
  'roEVPCipher', 'roEVPDigest',
  'roFileSystem', 'roFloat', 'roFont', 'roFontRegistry', 'roFunction',
  'roHMAC', 'roHdmiStatus', 'roHttpAgent',
  'roImageMetadata', 'roInput', 'roInt',
  'roList', 'roLocalization', 'roLongInteger',
  'roMessagePort',
  'roPath',
  'roRSA', 'roRegex', 'roRegion', 'roRegistry', 'roRegistrySection', 'roRemoteInfo',
  'roRenderThreadQueue',
  'roSGNode', 'roSGScreen', 'roScreen', 'roSocketAddress', 'roSprite',
  'roStreamSocket', 'roString', 'roSystemLog',
  'roTextToSpeech', 'roTextureManager', 'roTextureRequest', 'roTimespan',
  'roUrlTransfer',
  'roVideoPlayer',
  'roXMLElement', 'roXMLList',
];

const _componentMap = new Map<string, string>(
  COMPONENT_NAMES.map((name) => [name.toLowerCase(), name])
);

/** Returns the canonical component name if valid, or undefined if not found (case-insensitive). */
export function findComponent(name: string): string | undefined {
  return _componentMap.get(name.toLowerCase());
}
